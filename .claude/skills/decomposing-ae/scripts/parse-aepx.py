#!/usr/bin/env python3
"""Parse .aepx (After Effects XML) into clean JSON for HyperFrames decomposition."""
from __future__ import annotations

import json
import re
import struct
import sys
import xml.etree.ElementTree as ET


def decode_tdmn(hex_str: str) -> str:
    """Decode hex-encoded ASCII tdmn match name, stripping null padding."""
    raw = bytes.fromhex(hex_str)
    return raw.split(b'\x00')[0].decode('ascii')


def decode_cdta(bdata_hex: str) -> dict:
    """Decode a <cdta> bdata hex string into composition metadata.

    Known binary layout (big-endian):
      offset   4, uint32: frame count (total frames in comp)
      offset 140, uint16: width in pixels
      offset 142, uint16: height in pixels
      offset 156, uint32: frame rate as 16.16 unsigned fixed-point (e.g. 0x0017F9DB ≈ 23.976)

    Duration in seconds is derived as frame_count / frame_rate.
    """
    data = bytes.fromhex(bdata_hex)
    if len(data) < 160:
        return {}

    frame_count = struct.unpack('>I', data[4:8])[0]
    width = struct.unpack('>H', data[140:142])[0]
    height = struct.unpack('>H', data[142:144])[0]
    fps_fixed = struct.unpack('>I', data[156:160])[0]
    frame_rate = fps_fixed / 65536.0

    duration = frame_count / frame_rate if frame_rate > 0 else 0.0

    return {
        'width': width,
        'height': height,
        'frameRate': round(frame_rate, 6),
        'duration': round(duration, 6),
    }


_LAYER_TYPE_MAP = {
    0: 'avlayer',   # AVLayer: footage, solid, pre-comp, null, adjustment
    1: 'light',
    2: 'camera',
    3: 'text',
    4: 'shape',
}

NS = {'ae': 'http://www.adobe.com/products/aftereffects'}


def decode_ldta(bdata_hex: str) -> dict:
    """Decode a <ldta> bdata hex string into layer metadata.

    Known binary layout (big-endian):
      offset   0, uint32: layer id
      offset  12, uint32: in point (ticks)
      offset  16, uint32: tick rate
      offset  28, uint32: out point (ticks)
      offset 128, uint32: layer type (0=AVLayer, 1=Light, 2=Camera, 3=Text, 4=Shape)
    """
    data = bytes.fromhex(bdata_hex)
    if len(data) < 132:
        return {}

    layer_id = struct.unpack('>I', data[0:4])[0]
    in_point_ticks = struct.unpack('>I', data[12:16])[0]
    tick_rate = struct.unpack('>I', data[16:20])[0]
    out_point_ticks = struct.unpack('>I', data[28:32])[0]
    type_val = struct.unpack('>I', data[128:132])[0]

    in_point = in_point_ticks / tick_rate if tick_rate > 0 else 0.0
    out_point = out_point_ticks / tick_rate if tick_rate > 0 else 0.0
    layer_type = _LAYER_TYPE_MAP.get(type_val, 'unknown')

    return {
        'id': layer_id,
        'inPoint': round(in_point, 6),
        'outPoint': round(out_point, 6),
        'type': layer_type,
        'blendMode': 'normal',
        'trackMatteType': None,
        'parentIndex': None,
        'tickRate': tick_rate,
    }


def _decode_cdat_doubles(bdata_hex: str) -> list:
    """Decode a <cdat> bdata hex string into a list of big-endian IEEE 754 doubles."""
    data = bytes.fromhex(bdata_hex)
    count = len(data) // 8
    return [struct.unpack('>d', data[i * 8:(i + 1) * 8])[0] for i in range(count)]


def _decode_tdb4_dimensions(bdata_hex: str) -> int:
    """Decode a <tdb4> bdata hex string and return the number of dimensions.

    Layout:
      bytes 0-1: magic 0xDB99
      bytes 2-3: uint16 number of dimensions
    """
    data = bytes.fromhex(bdata_hex)
    if len(data) < 4:
        return 1
    return struct.unpack('>H', data[2:4])[0]


def _find_named_group(layr_el, match_name: str):
    """Find the first top-level <tdgp> child of <Layr> whose <tdmn> equals match_name.

    Walks the top-level <tdgp> children, decoding <tdmn> match names.
    Returns the matching <tdgp> element or None.
    """
    for top_tdgp in layr_el.findall('ae:tdgp', NS):
        current_match_name = None
        for child in top_tdgp:
            tag = child.tag.replace('{http://www.adobe.com/products/aftereffects}', '')
            if tag == 'tdmn':
                bdata = child.get('bdata', '')
                if bdata:
                    current_match_name = decode_tdmn(bdata)
            elif tag == 'tdgp' and current_match_name == match_name:
                return child
            elif tag in ('tdgp', 'tdbs'):
                current_match_name = None
    return None


def _find_transform_group(layr_el):
    """Find the ADBE Transform Group <tdgp> element inside a <Layr>."""
    return _find_named_group(layr_el, 'ADBE Transform Group')


def _decode_keyframes(tdbs_el, dims: int, tick_rate: float) -> list | None:
    """Decode keyframes from a <list> element inside a <tdbs> property block.

    Keyframe data is stored as:
      <list>
        <lhd3 bdata="..."/>  -- header: kf count at offset 8, entry size at offset 16
        <ldat bdata="..."/>  -- packed keyframe entries
      </list>

    1D entry (48 bytes): time(u32) flags(u32) value(f64) + tangent data
    3D entry (128 bytes): time(u32) flags(u32) value_x(f64) value_y(f64) value_z(f64) + tangents
    """
    lst = tdbs_el.find('ae:list', NS)
    if lst is None:
        return None

    lhd3 = lst.find('ae:lhd3', NS)
    ldat_el = lst.find('ae:ldat', NS)
    if lhd3 is None or ldat_el is None:
        return None

    hdr = bytes.fromhex(lhd3.get('bdata', ''))
    if len(hdr) < 20:
        return None

    kf_count = struct.unpack('>I', hdr[8:12])[0]
    entry_size = struct.unpack('>I', hdr[16:20])[0]
    if kf_count == 0 or entry_size == 0:
        return None

    ldat_data = bytes.fromhex(ldat_el.get('bdata', ''))
    if len(ldat_data) < kf_count * entry_size:
        return None

    if tick_rate <= 0:
        tick_rate = 24000.0

    keyframes = []
    for k in range(kf_count):
        entry = ldat_data[k * entry_size:(k + 1) * entry_size]
        if len(entry) < 16:
            continue

        time_ticks = struct.unpack('>I', entry[0:4])[0]
        flags = struct.unpack('>I', entry[4:8])[0]
        time_s = round(time_ticks / tick_rate, 6)

        # Interpolation type from flags byte
        interp_byte = (flags >> 24) & 0xFF
        if interp_byte == 0x03:
            easing_type = 'linear'
        elif interp_byte == 0x01:
            easing_type = 'bezier'
        else:
            easing_type = 'bezier'

        # Extract value(s) starting at offset 8
        if dims == 1 and entry_size >= 48:
            value = struct.unpack('>d', entry[8:16])[0]
            out_influence = struct.unpack('>d', entry[24:32])[0] if entry_size >= 32 else 0.0
            in_influence = struct.unpack('>d', entry[32:40])[0] if entry_size >= 40 else 0.0
        elif dims >= 2 and entry_size >= 8 + dims * 8:
            value = [struct.unpack('>d', entry[8 + i * 8:16 + i * 8])[0] for i in range(dims)]
            # Tangent data follows the values
            tangent_offset = 8 + dims * 8
            out_influence = 0.0
            in_influence = 0.0
            if entry_size >= tangent_offset + dims * 16:
                # Skip past tangent values to influence values
                influence_offset = tangent_offset + dims * 8
                if influence_offset + 8 <= entry_size:
                    out_influence = struct.unpack('>d', entry[influence_offset:influence_offset + 8])[0]
        else:
            value = struct.unpack('>d', entry[8:16])[0] if entry_size >= 16 else 0.0
            out_influence = 0.0
            in_influence = 0.0

        easing = {'type': easing_type}
        if easing_type == 'bezier':
            if isinstance(out_influence, float) and out_influence > 0:
                easing['outInfluence'] = round(out_influence, 6)
            if isinstance(in_influence, float) and in_influence > 0:
                easing['inInfluence'] = round(in_influence, 6)

        keyframes.append({
            'time': time_s,
            'value': value,
            'easing': easing,
        })

    return keyframes if keyframes else None


def _extract_property_from_tdbs(tdbs_el, tick_rate: float = 24000.0) -> dict:
    """Extract dimensions, value, and keyframes from a <tdbs> property element."""
    tdb4 = tdbs_el.find('ae:tdb4', NS)
    cdat = tdbs_el.find('ae:cdat', NS)
    tdsb = tdbs_el.find('ae:tdsb', NS)

    dims = 1
    if tdb4 is not None:
        bdata = tdb4.get('bdata', '')
        if bdata:
            dims = _decode_tdb4_dimensions(bdata)

    doubles = []
    if cdat is not None:
        bdata = cdat.get('bdata', '')
        if bdata:
            doubles = _decode_cdat_doubles(bdata)

    # Static value is the first N doubles where N = dimensions
    value = doubles[:dims] if len(doubles) >= dims else doubles

    # Simplify scalar values (rotation, opacity) to a single number
    if dims == 1 and len(value) == 1:
        value = value[0]

    # Check if property is keyframed (tdsb=1 means animated)
    keyframes = None
    if tdsb is not None:
        tdsb_val = struct.unpack('>I', bytes.fromhex(tdsb.get('bdata', '00000000')))[0]
        if tdsb_val == 1:
            keyframes = _decode_keyframes(tdbs_el, dims, tick_rate)

    return {
        'value': value,
        'dimensions': dims,
        'keyframes': keyframes,
    }


def extract_transforms(layr_el, tick_rate: float = 24000.0) -> dict:
    """Extract transform properties from a <Layr> element."""
    transform = {
        'anchorPoint': {'value': [0, 0, 0], 'keyframes': None},
        'position': {'value': [0, 0, 0], 'keyframes': None},
        'scale': {'value': [1, 1, 1], 'keyframes': None},
        'rotation': {'value': 0, 'keyframes': None},
        'opacity': {'value': 1, 'keyframes': None},
    }

    transform_group = _find_transform_group(layr_el)
    if transform_group is None:
        return transform

    # Map tdmn match names to our output keys
    MATCH_NAME_MAP = {
        'ADBE Anchor Point': 'anchorPoint',
        'ADBE Position': 'position',
        'ADBE Scale': 'scale',
        'ADBE Rotate Z': 'rotation',
        'ADBE Opacity': 'opacity',
    }

    # Separated position axes
    POSITION_AXIS_MAP = {
        'ADBE Position_0': 0,  # X
        'ADBE Position_1': 1,  # Y
        'ADBE Position_2': 2,  # Z
    }

    has_separated_position = False
    separated_position = [0.0, 0.0, 0.0]
    separated_position_keyframes = {0: None, 1: None, 2: None}

    current_match_name = None
    for child in transform_group:
        tag = child.tag.replace('{http://www.adobe.com/products/aftereffects}', '')

        if tag == 'tdmn':
            bdata = child.get('bdata', '')
            if bdata:
                current_match_name = decode_tdmn(bdata)
            continue

        if tag == 'tdbs' and current_match_name:
            prop = _extract_property_from_tdbs(child, tick_rate)

            if current_match_name in MATCH_NAME_MAP:
                key = MATCH_NAME_MAP[current_match_name]
                value = prop['value']
                # Keep default if extraction yielded empty/no data
                if value == [] or value is None:
                    value = transform[key]['value']
                transform[key] = {
                    'value': value,
                    'keyframes': prop.get('keyframes'),
                }
            elif current_match_name in POSITION_AXIS_MAP:
                has_separated_position = True
                axis_idx = POSITION_AXIS_MAP[current_match_name]
                val = prop['value']
                if isinstance(val, list):
                    separated_position[axis_idx] = val[0] if val else 0.0
                else:
                    separated_position[axis_idx] = val
                separated_position_keyframes[axis_idx] = prop.get('keyframes')

            current_match_name = None

        elif tag == 'tdgp' and current_match_name:
            current_match_name = None

    # If position was separated into X/Y/Z, combine them
    if has_separated_position:
        # Merge per-axis keyframes into combined 3D keyframes
        axis_kfs = [separated_position_keyframes.get(i) for i in range(3)]
        has_any_kfs = any(kf is not None for kf in axis_kfs)

        if has_any_kfs:
            # Collect all unique keyframe times across axes
            all_times = set()
            for kf_list in axis_kfs:
                if kf_list:
                    for kf in kf_list:
                        all_times.add(kf['time'])
            all_times = sorted(all_times)

            # Build combined keyframes at each time
            combined_kfs = []
            for t in all_times:
                vals = list(separated_position)  # start with static values
                easing = {'type': 'bezier'}
                for axis in range(3):
                    if axis_kfs[axis]:
                        # Find the keyframe at this time for this axis
                        for kf in axis_kfs[axis]:
                            if abs(kf['time'] - t) < 0.001:
                                vals[axis] = kf['value']
                                easing = kf.get('easing', easing)
                                break
                combined_kfs.append({'time': t, 'value': vals, 'easing': easing})

            transform['position'] = {
                'value': separated_position,
                'keyframes': combined_kfs,
            }
        else:
            transform['position'] = {
                'value': separated_position,
                'keyframes': None,
            }

    return transform


def _find_btdk_for_text_layer(layr_el):
    """Find the <btdk> element inside a text layer's ADBE Text Document property.

    Path: <Layr> -> <tdgp> -> tdmn(ADBE Text Properties) -> <tdgp> ->
          tdmn(ADBE Text Document) -> <btds> -> <btdk>

    Returns the btdk element or None if this is not a text layer.
    """
    for top_tdgp in layr_el.findall('ae:tdgp', NS):
        current_mn = None
        for child in top_tdgp:
            tag = child.tag.replace('{http://www.adobe.com/products/aftereffects}', '')
            if tag == 'tdmn':
                bdata = child.get('bdata', '')
                if bdata:
                    current_mn = decode_tdmn(bdata)
            elif tag == 'tdgp' and current_mn == 'ADBE Text Properties':
                # Walk inside for ADBE Text Document
                inner_mn = None
                for inner_child in child:
                    inner_tag = inner_child.tag.replace(
                        '{http://www.adobe.com/products/aftereffects}', ''
                    )
                    if inner_tag == 'tdmn':
                        inner_bdata = inner_child.get('bdata', '')
                        if inner_bdata:
                            inner_mn = decode_tdmn(inner_bdata)
                    elif inner_tag == 'btds' and inner_mn == 'ADBE Text Document':
                        btdk = inner_child.find('ae:btdk', NS)
                        if btdk is not None:
                            return btdk
                return None
            elif tag in ('tdgp', 'tdbs', 'btds'):
                current_mn = None
    return None


def _decode_btdk_utf16_strings(raw: bytes) -> list:
    """Extract all UTF-16BE strings (with \\xfe\\xff BOM) from raw btdk bytes.

    Returns a list of (byte_offset, decoded_text) tuples.
    """
    results = []
    i = 0
    while i < len(raw):
        if raw[i] == 0x28:  # opening paren
            depth = 1
            j = i + 1
            while j < len(raw) and depth > 0:
                if raw[j] == 0x28:
                    depth += 1
                elif raw[j] == 0x29:
                    depth -= 1
                j += 1
            content = raw[i + 1:j - 1]
            if len(content) >= 4 and content[:2] == b'\xfe\xff':
                text = content[2:].decode('utf-16-be', errors='replace')
                results.append((i, text))
            i = j
        else:
            i += 1
    return results


def _rgba_to_hex(r: float, g: float, b: float) -> str:
    """Convert 0.0-1.0 RGB floats to a #rrggbb hex string."""
    ri = max(0, min(255, int(round(r * 255))))
    gi = max(0, min(255, int(round(g * 255))))
    bi = max(0, min(255, int(round(b * 255))))
    return f'#{ri:02x}{gi:02x}{bi:02x}'


_EXPRESSION_MARKERS = ('comp(', 'effect(', 'thisComp', 'wiggle(', 'time', 'value')


def extract_effects(layr_el, warnings: list) -> list:
    """Extract effects from the ADBE Effect Parade group inside a <Layr>.

    Structure inside the parade group:
      <tdsb/>
      <tdsn><string>-_0_/-</string></tdsn>   (internal name, often placeholder)
      <tdmn bdata="..."/>                      (effect match name, e.g. "ADBE Fill")
      <sspc>
        <fnam><string>Fill</string></fnam>     (human-readable display name)
        ...
      </sspc>
      <tdmn bdata="ADBE Group End"/>

    Returns a list of dicts with 'name' and 'displayName'.
    Any decoding errors append a message to warnings.
    """
    effect_parade = _find_named_group(layr_el, 'ADBE Effect Parade')
    if effect_parade is None:
        return []

    effects = []
    pending_match_name = None
    for child in effect_parade:
        tag = child.tag.replace('{http://www.adobe.com/products/aftereffects}', '')
        if tag == 'tdmn':
            bdata = child.get('bdata', '')
            if bdata:
                try:
                    pending_match_name = decode_tdmn(bdata)
                except Exception as exc:
                    warnings.append(f'effect tdmn decode error: {exc}')
                    pending_match_name = None
        elif tag == 'sspc' and pending_match_name:
            effect_name = pending_match_name
            # Skip the sentinel that closes each group
            if effect_name == 'ADBE Group End':
                pending_match_name = None
                continue
            # Read human-readable name from <fnam><string>
            display_name = None
            fnam_el = child.find('ae:fnam', NS)
            if fnam_el is not None:
                str_el = fnam_el.find('ae:string', NS)
                if str_el is not None and str_el.text:
                    display_name = str_el.text
            effects.append({'name': effect_name, 'displayName': display_name})
            pending_match_name = None

    return effects


def extract_masks(layr_el) -> list:
    """Extract mask records from the ADBE Mask Parade group inside a <Layr>.

    For v1 we only record the existence of each mask (count), not path data.
    Returns a list of dicts with 'name'.
    """
    mask_parade = _find_named_group(layr_el, 'ADBE Mask Parade')
    if mask_parade is None:
        return []

    masks = []
    current_match_name = None
    mask_index = 1
    for child in mask_parade:
        tag = child.tag.replace('{http://www.adobe.com/products/aftereffects}', '')
        if tag == 'tdmn':
            bdata = child.get('bdata', '')
            if bdata:
                try:
                    current_match_name = decode_tdmn(bdata)
                except Exception:
                    current_match_name = None
        elif tag == 'tdgp' and current_match_name:
            # Each tdgp under the parade is one mask
            # Try to read a name from a tdsn inside
            mask_display_name = f'Mask {mask_index}'
            inner_mn = None
            for inner in child:
                inner_tag = inner.tag.replace(
                    '{http://www.adobe.com/products/aftereffects}', ''
                )
                if inner_tag == 'tdmn':
                    ibdata = inner.get('bdata', '')
                    if ibdata:
                        try:
                            inner_mn = decode_tdmn(ibdata)
                        except Exception:
                            inner_mn = None
                elif inner_tag == 'tdsn' and inner_mn is None:
                    str_el = inner.find('ae:string', NS)
                    if str_el is not None and str_el.text:
                        mask_display_name = str_el.text
                    break

            masks.append({'name': mask_display_name})
            mask_index += 1
            current_match_name = None
        elif tag in ('tdgp', 'tdbs'):
            current_match_name = None

    return masks


def _looks_like_expression(text: str) -> bool:
    """Return True if text appears to be an AE expression."""
    if not text:
        return False
    for marker in _EXPRESSION_MARKERS:
        if marker in text:
            return True
    return False


def extract_expression(layr_el) -> str | None:
    """Find the first expression string on any property in the layer.

    AE expressions live as <string> children of <tdbs> blocks.
    Returns the first expression text found, or None.
    """
    for tdbs_el in layr_el.iter('{http://www.adobe.com/products/aftereffects}tdbs'):
        for str_el in tdbs_el.findall('ae:string', NS):
            text = str_el.text or ''
            if _looks_like_expression(text):
                return text
    return None


def extract_text_data(layr_el, layer_name: str = None) -> dict | None:
    """Extract text content, font, size, color from a text layer.

    Returns a dict with textContent, fontFamily, fontSize, fontColor,
    or None if this is not a text layer.
    """
    btdk = _find_btdk_for_text_layer(layr_el)
    if btdk is None:
        return None

    bdata_hex = btdk.get('bdata', '')
    if not bdata_hex:
        return None

    raw = bytes.fromhex(bdata_hex)

    # Build an ASCII representation replacing non-printable bytes with spaces
    # for regex pattern matching on the PostScript-like dictionary
    ascii_text = ''
    for b in raw:
        if 32 <= b < 127:
            ascii_text += chr(b)
        else:
            ascii_text += ' '

    # --- Extract font name ---
    # First UTF-16BE string that looks like a PostScript font name (e.g. "Montserrat-Black")
    utf16_strings = _decode_btdk_utf16_strings(raw)
    font_full_name = None
    for _pos, text in utf16_strings:
        if re.match(r'^[A-Za-z][A-Za-z0-9]+-[A-Za-z][A-Za-z0-9]+$', text):
            font_full_name = text
            break

    # Derive font family by stripping the weight suffix (e.g. "Montserrat-Black" -> "Montserrat")
    font_family = None
    if font_full_name:
        font_family = font_full_name.split('-')[0]

    # --- Extract font size ---
    # In the character style section (/6 << ... /5 NN.N ...), /5 is the font size
    font_size = None
    m = re.search(r'/6 << /0 \d+ /1 [\d.]+ /2 \w+ /3 \w+ /4 \w+ /5 ([\d.]+)', ascii_text)
    if m:
        try:
            font_size = float(m.group(1))
            if font_size == int(font_size):
                font_size = int(font_size)
        except ValueError:
            pass

    # --- Extract fill color ---
    # /79 << /99 /SimplePaint /0 << /0 N /1 [ R G B A ] >> >> is the fill color
    font_color = None
    m = re.search(
        r'/79 << /99 /SimplePaint /0 << /0 \d+ /1 \[ ([\d.]+) ([\d.]+) ([\d.]+) [\d.]+ \]',
        ascii_text,
    )
    if m:
        font_color = _rgba_to_hex(float(m.group(1)), float(m.group(2)), float(m.group(3)))

    # --- Extract text content ---
    # The actual text appears as a UTF-16BE string after a TkD- hash string.
    # Fall back to the layer name if not found.
    text_content = None
    found_tkd = False
    for _pos, text in utf16_strings:
        if found_tkd and len(text) > 0:
            text_content = text
            break
        if text.startswith('TkD-'):
            found_tkd = True

    if not text_content and layer_name:
        text_content = layer_name

    if text_content:
        text_content = text_content.strip('\r\n ')

    return {
        'textContent': text_content,
        'fontFamily': font_family,
        'fontSize': font_size,
        'fontColor': font_color,
    }


def _guess_footage_type(name: str) -> str:
    """Guess a footage type from the item name based on file extension."""
    if name is None:
        return 'unknown'
    lower = name.lower()
    if any(lower.endswith(ext) for ext in ('.mp4', '.mov', '.avi', '.mkv', '.wmv', '.webm')):
        return 'video'
    if any(lower.endswith(ext) for ext in ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif',
                                            '.tiff', '.exr', '.hdr', '.dpx')):
        return 'image'
    if any(lower.endswith(ext) for ext in ('.wav', '.mp3', '.aac', '.aif', '.aiff', '.ogg')):
        return 'audio'
    # AE solids are often named like "White Solid 1" or end with no extension
    if '.' not in name:
        return 'solid'
    return 'unknown'


def _parse_items(items_el_list, compositions: dict, comp_counter: list,
                  all_fonts: set, footage: dict, warnings: list) -> list:
    """Recursively walk a list of <Item> elements and build folder tree nodes.

    compositions is mutated in place.
    comp_counter is a one-element list used as a mutable integer counter.
    all_fonts is a set that collects unique font family names across the project.
    footage is mutated in place with non-comp, non-folder items.
    warnings is mutated in place with any non-fatal issues encountered.
    Returns a list of folder/comp node dicts.
    """
    nodes = []
    for item in items_el_list:
        string_el = item.find('ae:string', NS)
        iide_el = item.find('ae:iide', NS)
        sfdr_el = item.find('ae:Sfdr', NS)
        cdta_el = item.find('ae:cdta', NS)

        name = string_el.text if string_el is not None else None
        iide = iide_el.get('bdata') if iide_el is not None else None

        if sfdr_el is not None:
            # Folder: recurse into its Item children
            child_items = sfdr_el.findall('ae:Item', NS)
            children = _parse_items(
                child_items, compositions, comp_counter, all_fonts, footage, warnings
            )
            node = {'type': 'folder', 'name': name, 'iide': iide, 'children': children}
            nodes.append(node)
        elif cdta_el is not None:
            # Composition
            comp_id = f'comp_{comp_counter[0]:04d}'
            comp_counter[0] += 1
            cdta_meta = decode_cdta(cdta_el.get('bdata', ''))

            # Extract layers from this composition item
            layers = []
            layr_elements = item.findall('.//ae:Layr', NS)
            for idx, layr_el in enumerate(layr_elements, start=1):
                ldta_el = layr_el.find('ae:ldta', NS)
                layer_string_el = layr_el.find('ae:string', NS)
                layer_name = layer_string_el.text if layer_string_el is not None else None

                layer_meta = {}
                if ldta_el is not None:
                    bdata = ldta_el.get('bdata', '')
                    if bdata:
                        layer_meta = decode_ldta(bdata)

                layer = {
                    'index': idx,
                    'name': layer_name,
                    'type': layer_meta.get('type', 'unknown'),
                    'inPoint': layer_meta.get('inPoint', 0.0),
                    'outPoint': layer_meta.get('outPoint', 0.0),
                    'blendMode': layer_meta.get('blendMode', 'normal'),
                    'trackMatteType': layer_meta.get('trackMatteType', None),
                    'parentIndex': layer_meta.get('parentIndex', None),
                    'transform': extract_transforms(layr_el, layer_meta.get('tickRate', 24000.0)),
                    'effects': extract_effects(layr_el, warnings),
                    'masks': extract_masks(layr_el),
                    'expression': extract_expression(layr_el),
                }

                # Extract text data if this is a text layer
                text_data = extract_text_data(layr_el, layer_name)
                if text_data is not None:
                    layer['type'] = 'text'
                    layer['textContent'] = text_data.get('textContent')
                    layer['fontFamily'] = text_data.get('fontFamily')
                    layer['fontSize'] = text_data.get('fontSize')
                    layer['fontColor'] = text_data.get('fontColor')
                    if text_data.get('fontFamily'):
                        all_fonts.add(text_data['fontFamily'])

                layers.append(layer)

            compositions[comp_id] = {
                'name': name,
                'iide': iide,
                'width': cdta_meta.get('width', 0),
                'height': cdta_meta.get('height', 0),
                'frameRate': cdta_meta.get('frameRate', 0.0),
                'duration': cdta_meta.get('duration', 0.0),
                'layers': layers,
            }
            node = {'type': 'composition', 'name': name, 'iide': iide, 'comp_id': comp_id}
            nodes.append(node)
        else:
            # Footage item (not a folder, not a composition)
            # The <string> may be empty for solids; try <Pin><opti> bdata for name
            resolved_name = name
            if not resolved_name:
                pin_el = item.find('ae:Pin', NS)
                if pin_el is not None:
                    opti_el = pin_el.find('ae:opti', NS)
                    if opti_el is not None:
                        bdata = opti_el.get('bdata', '')
                        if bdata:
                            raw = bytes.fromhex(bdata)
                            # Find printable ASCII runs of 3+ chars; last one is the name
                            runs = re.findall(b'[ -~]{3,}', raw)
                            if len(runs) >= 2:
                                # First run is usually the type code ("Soli"), last is name
                                resolved_name = runs[-1].decode('ascii').strip()

            footage_id = iide if iide else f'footage_{len(footage):04d}'
            footage_type = _guess_footage_type(resolved_name or '')

            # Try to find a file path from a <Pin><string> element
            file_path = None
            pin_el = item.find('ae:Pin', NS)
            if pin_el is not None:
                path_str_el = pin_el.find('ae:string', NS)
                if path_str_el is not None and path_str_el.text:
                    file_path = path_str_el.text

            footage[footage_id] = {
                'name': resolved_name,
                'type': footage_type,
                'filePath': file_path,
            }

    return nodes


def main():
    if len(sys.argv) < 2:
        print("Usage: parse-aepx.py <path-to-aepx>", file=sys.stderr)
        sys.exit(1)

    path = sys.argv[1]
    try:
        tree = ET.parse(path)
    except ET.ParseError as e:
        print(f"XML parse error: {e}", file=sys.stderr)
        sys.exit(1)

    root = tree.getroot()
    fold = root.find('ae:Fold', NS)
    if fold is None:
        print("No <Fold> element found in project", file=sys.stderr)
        sys.exit(1)

    compositions: dict = {}
    comp_counter = [0]
    all_fonts: set = set()
    footage: dict = {}
    warnings: list = []

    top_items = fold.findall('ae:Item', NS)
    folders = _parse_items(
        top_items, compositions, comp_counter, all_fonts, footage, warnings
    )

    output = {
        'folders': folders,
        'compositions': compositions,
        'footage': footage,
        'fonts': sorted(all_fonts),
        'warnings': warnings,
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
