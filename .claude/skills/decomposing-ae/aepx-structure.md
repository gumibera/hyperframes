# .aepx XML Format Reference

## Top-level Structure

```xml
<AfterEffectsProject xmlns="http://www.adobe.com/products/aftereffects">
  <Pefl>...</Pefl>   <!-- plugin effects -->
  <EfdG>...</EfdG>   <!-- effect definitions -->
  <Fold>...</Fold>   <!-- project root, contains all items -->
</AfterEffectsProject>
```

## Item Types within `<Fold>`

### Folder

```xml
<Item>
  <Sfdr/>            <!-- presence indicates folder -->
  <string>Name</string>
</Item>
```

### Composition

```xml
<Item>
  <cdta>...</cdta>   <!-- binary composition data -->
  <Layr>...</Layr>   <!-- one per layer -->
  ...
</Item>
```

### Footage

`<Item>` without `<Sfdr>` or `<cdta>`.

## Composition Data (`<cdta>`)

Binary blob (hex-encoded). Key offsets:

| Field       | Offset | Type                    | Notes                        |
| ----------- | ------ | ----------------------- | ---------------------------- |
| frame_count | 4      | uint32 big-endian       |                              |
| width       | 140    | uint16 big-endian       | pixels                       |
| height      | 142    | uint16 big-endian       | pixels                       |
| frame_rate  | 156    | uint32 big-endian 16.16 | fixed-point: value / 65536.0 |

Duration = `frame_count / frame_rate`

## Layer Data (`<Layr>` + `<ldta>`)

`<ldta>` is a binary blob. `<string>` sibling holds layer name.

Key fields in `<ldta>`:

| Field      | Offset | Type   | Notes                          |
| ---------- | ------ | ------ | ------------------------------ |
| layer_id   | 0      | uint32 | unique layer identifier        |
| in_point   | 12     | uint32 | ticks from comp start          |
| tick_rate  | 16     | uint32 | ticks per second (e.g., 24000) |
| out_point  | 28     | uint32 | ticks from comp start          |
| layer_type | 128    | uint32 | see types below                |

Layer type values at offset 128:

- `0` — AVLayer (footage/comp/solid)
- `1` — Light
- `2` — Camera
- `3` — Text
- `4` — Shape

## Property Groups (`<tdgp>`)

Groups are identified by `<tdmn>` (hex-encoded match name).

Key match names:

| Decoded Name           | Contents                                         |
| ---------------------- | ------------------------------------------------ |
| `ADBE Transform Group` | position, scale, rotation, opacity, anchor point |
| `ADBE Text Properties` | contains `ADBE Text Document`                    |
| `ADBE Text Document`   | text content in `<btds>`/`<btdk>`                |
| `ADBE Effect Parade`   | list of applied effects                          |
| `ADBE Mask Parade`     | list of masks                                    |

## Property Values (`<tdbs>`)

```xml
<tdbs>
  <tdb4>...</tdb4>   <!-- metadata; bytes 2-3 = dimensions (num doubles in cdat) -->
  <cdat>...</cdat>   <!-- IEEE 754 doubles, big-endian -->
  <string>...</string> <!-- optional: expression source -->
</tdbs>
```

## Hex Decoding

### `<tdmn>` — match name

40-byte null-padded hex-encoded ASCII:

```python
bytes.fromhex(s).split(b'\x00')[0].decode('ascii')
```

### `<cdat>` — property value doubles

```python
import struct
struct.unpack('>d', bytes.fromhex(cdat_hex)[offset:offset+8])
```

Read `n` doubles where `n` = value of bytes 2-3 in `<tdb4>`.

## Common Folder Conventions

| Folder Name      | Purpose              |
| ---------------- | -------------------- |
| `01. Edit`       | User-editable comps  |
| `02. Final Comp` | Render output comp   |
| `03. Others`     | Helper/precomp items |
