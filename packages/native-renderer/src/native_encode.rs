use std::io::{Cursor, Write};

use dcv_color_primitives as dcp;
use openh264::encoder::Encoder;
use openh264::formats::YUVBuffer;

pub struct NativeEncoder {
    encoder: Encoder,
    width: u32,
    height: u32,
    fps: u32,
    i420_buf: Vec<u8>,
    h264_data: Vec<u8>,
    frame_count: u32,
}

impl NativeEncoder {
    pub fn new(width: u32, height: u32, fps: u32) -> Result<Self, String> {
        let encoder = Encoder::new().map_err(|e| format!("openh264 init: {e}"))?;
        let i420_size = (3 * (width as usize * height as usize)) / 2;

        Ok(Self {
            encoder,
            width,
            height,
            fps,
            i420_buf: vec![0u8; i420_size],
            h264_data: Vec::with_capacity(1024 * 1024),
            frame_count: 0,
        })
    }

    pub fn encode_bgra_frame(&mut self, bgra: &[u8]) -> Result<(), String> {
        let w = self.width;
        let h = self.height;
        let y_size = (w * h) as usize;
        let uv_size = ((w / 2) * (h / 2)) as usize;

        let src_format = dcp::ImageFormat {
            pixel_format: dcp::PixelFormat::Bgra,
            color_space: dcp::ColorSpace::Rgb,
            num_planes: 1,
        };
        let dst_format = dcp::ImageFormat {
            pixel_format: dcp::PixelFormat::I420,
            color_space: dcp::ColorSpace::Bt601,
            num_planes: 3,
        };

        let (y_slice, uv_rest) = self.i420_buf.split_at_mut(y_size);
        let (u_slice, v_slice) = uv_rest.split_at_mut(uv_size);

        dcp::convert_image(
            w,
            h,
            &src_format,
            None,
            &[bgra],
            &dst_format,
            None,
            &mut [y_slice, u_slice, v_slice],
        )
        .map_err(|e| format!("BGRA→I420: {e:?}"))?;

        let yuv =
            YUVBuffer::from_vec(self.i420_buf.clone(), self.width as usize, self.height as usize);

        let bitstream = self
            .encoder
            .encode(&yuv)
            .map_err(|e| format!("H.264 encode: {e}"))?;

        bitstream.write_vec(&mut self.h264_data);
        self.frame_count += 1;
        Ok(())
    }

    pub fn finish_to_mp4(self, output_path: &str) -> Result<EncodeResult, String> {
        let mut cursor = Cursor::new(Vec::with_capacity(self.h264_data.len() + 4096));

        {
            let mut muxer = minimp4::Mp4Muxer::new(&mut cursor);
            muxer.init_video(
                self.width as i32,
                self.height as i32,
                false,
                "hyperframes",
            );
            muxer.write_video_with_fps(&self.h264_data, self.fps);
            muxer.close();
        }

        let mp4_buf = cursor.into_inner();
        let file_size = mp4_buf.len();
        let mut file =
            std::fs::File::create(output_path).map_err(|e| format!("create {output_path}: {e}"))?;
        file.write_all(&mp4_buf)
            .map_err(|e| format!("write {output_path}: {e}"))?;

        Ok(EncodeResult {
            file_size,
            frame_count: self.frame_count,
        })
    }
}

pub struct EncodeResult {
    pub file_size: usize,
    pub frame_count: u32,
}
