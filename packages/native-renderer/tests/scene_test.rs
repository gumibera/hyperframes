use hyperframes_native_renderer::scene::{
    parse_scene_json, BackgroundImageFit, Color, ElementKind,
};

#[test]
fn parse_minimal_scene() {
    let json = r#"{
        "width": 1920,
        "height": 1080,
        "elements": [{
            "id": "bg",
            "kind": { "type": "Container" },
            "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
            "style": {
                "background_color": { "r": 30, "g": 30, "b": 30, "a": 255 },
                "opacity": 1.0,
                "border_radius": [0, 0, 0, 0],
                "overflow_hidden": false,
                "transform": null,
                "visibility": true
            },
            "children": []
        }]
    }"#;

    let scene = parse_scene_json(json).expect("should parse");
    assert_eq!(scene.width, 1920);
    assert_eq!(scene.height, 1080);
    assert_eq!(scene.elements.len(), 1);

    let el = &scene.elements[0];
    assert_eq!(el.id, "bg");
    assert!(matches!(el.kind, ElementKind::Container));
    assert_eq!(el.bounds.x, 0.0);
    assert_eq!(el.bounds.width, 1920.0);
    assert_eq!(
        el.style.background_color,
        Some(Color {
            r: 30,
            g: 30,
            b: 30,
            a: 255
        })
    );
    assert_eq!(el.style.opacity, 1.0);
    assert!(el.style.visibility);
    assert!(el.children.is_empty());
}

#[test]
fn parse_nested_children_with_text() {
    let json = r#"{
        "width": 1280,
        "height": 720,
        "elements": [{
            "id": "root",
            "kind": { "type": "Container" },
            "bounds": { "x": 0, "y": 0, "width": 1280, "height": 720 },
            "children": [{
                "id": "title",
                "kind": { "type": "Text", "content": "Hello World" },
                "bounds": { "x": 100, "y": 50, "width": 400, "height": 60 },
                "style": {
                    "font_family": "Inter",
                    "font_size": 48.0,
                    "font_weight": 700,
                    "color": { "r": 255, "g": 255, "b": 255, "a": 255 }
                },
                "children": []
            }, {
                "id": "subtitle",
                "kind": { "type": "Text", "content": "Subtitle" },
                "bounds": { "x": 100, "y": 120, "width": 400, "height": 30 },
                "children": []
            }]
        }]
    }"#;

    let scene = parse_scene_json(json).expect("should parse");
    assert_eq!(scene.width, 1280);
    assert_eq!(scene.height, 720);
    assert_eq!(scene.elements.len(), 1);

    let root = &scene.elements[0];
    assert_eq!(root.children.len(), 2);

    let title = &root.children[0];
    assert_eq!(title.id, "title");
    match &title.kind {
        ElementKind::Text { content } => assert_eq!(content, "Hello World"),
        other => panic!("expected Text, got {other:?}"),
    }
    assert_eq!(title.style.font_family.as_deref(), Some("Inter"));
    assert_eq!(title.style.font_size, Some(48.0));
    assert_eq!(title.style.font_weight, Some(700));
    assert_eq!(
        title.style.color,
        Some(Color {
            r: 255,
            g: 255,
            b: 255,
            a: 255
        })
    );

    let subtitle = &root.children[1];
    assert_eq!(subtitle.id, "subtitle");
    // subtitle has default style — opacity 1.0, visible, no font info
    assert_eq!(subtitle.style.opacity, 1.0);
    assert!(subtitle.style.visibility);
    assert!(subtitle.style.font_family.is_none());
}

#[test]
fn parse_image_and_video_elements() {
    let json = r#"{
        "width": 1920,
        "height": 1080,
        "elements": [
            {
                "id": "bg-img",
                "kind": { "type": "Image", "src": "/assets/bg.png" },
                "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
                "children": []
            },
            {
                "id": "clip",
                "kind": { "type": "Video", "src": "/assets/intro.mp4" },
                "bounds": { "x": 100, "y": 100, "width": 800, "height": 450 },
                "style": {
                    "opacity": 0.8,
                    "overflow_hidden": true,
                    "border_radius": [12, 12, 12, 12]
                },
                "children": []
            }
        ]
    }"#;

    let scene = parse_scene_json(json).expect("should parse");
    assert_eq!(scene.elements.len(), 2);

    match &scene.elements[0].kind {
        ElementKind::Image { src } => assert_eq!(src, "/assets/bg.png"),
        other => panic!("expected Image, got {other:?}"),
    }

    let clip = &scene.elements[1];
    match &clip.kind {
        ElementKind::Video { src } => assert_eq!(src, "/assets/intro.mp4"),
        other => panic!("expected Video, got {other:?}"),
    }
    assert_eq!(clip.style.opacity, 0.8);
    assert!(clip.style.overflow_hidden);
    assert_eq!(clip.style.border_radius, [12.0, 12.0, 12.0, 12.0]);
}

#[test]
fn parse_background_image_layer() {
    let json = r#"{
        "width": 640,
        "height": 360,
        "elements": [{
            "id": "poster",
            "kind": { "type": "Container" },
            "bounds": { "x": 0, "y": 0, "width": 640, "height": 360 },
            "style": {
                "background_image": {
                    "src": "file:///tmp/poster.png",
                    "fit": "contain",
                    "position": { "x": 0.25, "y": 0.75 }
                }
            },
            "children": []
        }]
    }"#;

    let scene = parse_scene_json(json).expect("should parse");
    let background_image = scene.elements[0]
        .style
        .background_image
        .as_ref()
        .expect("should parse background image");

    assert_eq!(background_image.src, "file:///tmp/poster.png");
    assert_eq!(background_image.fit, BackgroundImageFit::Contain);
    assert_eq!(background_image.position.x, 0.25);
    assert_eq!(background_image.position.y, 0.75);
}

#[test]
fn parse_transform() {
    let json = r#"{
        "width": 800,
        "height": 600,
        "elements": [{
            "id": "box",
            "kind": { "type": "Container" },
            "bounds": { "x": 100, "y": 100, "width": 200, "height": 200 },
            "style": {
                "transform": {
                    "translate_x": 50.0,
                    "translate_y": -30.0,
                    "scale_x": 1.5,
                    "scale_y": 1.5,
                    "rotate_deg": 45.0
                }
            },
            "children": []
        }]
    }"#;

    let scene = parse_scene_json(json).expect("should parse");
    let t = scene.elements[0]
        .style
        .transform
        .as_ref()
        .expect("should have transform");
    assert_eq!(t.translate_x, 50.0);
    assert_eq!(t.translate_y, -30.0);
    assert_eq!(t.scale_x, 1.5);
    assert_eq!(t.scale_y, 1.5);
    assert_eq!(t.rotate_deg, 45.0);
}

#[test]
fn invalid_json_returns_error() {
    let result = parse_scene_json("not json");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("invalid scene JSON"));
}

#[test]
fn roundtrip_serialize_deserialize() {
    let json = r#"{
        "width": 1920,
        "height": 1080,
        "elements": [{
            "id": "bg",
            "kind": { "type": "Container" },
            "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
            "children": []
        }]
    }"#;

    let scene = parse_scene_json(json).expect("should parse");
    let serialized = serde_json::to_string(&scene).expect("should serialize");
    let reparsed = parse_scene_json(&serialized).expect("should reparse");
    assert_eq!(reparsed.width, scene.width);
    assert_eq!(reparsed.height, scene.height);
    assert_eq!(reparsed.elements.len(), scene.elements.len());
    assert_eq!(reparsed.elements[0].id, scene.elements[0].id);
}

#[test]
fn parse_video_frames_dir_in_style() {
    let json = r#"{
        "width": 100, "height": 100, "fonts": [],
        "elements": [{
            "id": "vid",
            "kind": { "type": "Image", "src": "/tmp/fallback.png" },
            "bounds": { "x": 0, "y": 0, "width": 100, "height": 100 },
            "style": {
                "opacity": 1.0,
                "visibility": true,
                "video_frames_dir": "/tmp/test-frames",
                "video_fps": 30.0,
                "video_media_start": 0.5
            },
            "children": []
        }]
    }"#;
    let scene = hyperframes_native_renderer::scene::parse_scene_json(json).unwrap();
    let el = &scene.elements[0];
    assert_eq!(el.style.video_frames_dir.as_deref(), Some("/tmp/test-frames"));
    assert_eq!(el.style.video_fps, Some(30.0));
    assert_eq!(el.style.video_media_start, Some(0.5));
}
