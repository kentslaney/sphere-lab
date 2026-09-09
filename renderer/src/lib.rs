use glam::{Mat4, Vec3};
use wasm_bindgen::prelude::*;
use wgpu::util::DeviceExt;

#[wasm_bindgen]
pub struct Renderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    vertices: wgpu::Buffer,
    vertex_count: u32,
    uniform: wgpu::Buffer,
    bind: wgpu::BindGroup,
    pipeline: Option<wgpu::RenderPipeline>,
    format: Option<wgpu::TextureFormat>,
}

fn format(name: &str) -> Result<wgpu::TextureFormat, JsValue> {
    match name {
        "rgba8unorm" => Ok(wgpu::TextureFormat::Rgba8Unorm),
        "bgra8unorm" => Ok(wgpu::TextureFormat::Bgra8Unorm),
        "rgba8unorm-srgb" => Ok(wgpu::TextureFormat::Rgba8UnormSrgb),
        "bgra8unorm-srgb" => Ok(wgpu::TextureFormat::Bgra8UnormSrgb),
        "rgba16float" => Ok(wgpu::TextureFormat::Rgba16Float),
        "depth24plus" => Ok(wgpu::TextureFormat::Depth24Plus),
        _ => Err(JsValue::from_str(&format!(
            "Unsupported texture format: {name}"
        ))),
    }
}

#[wasm_bindgen]
impl Renderer {
    pub async fn create() -> Result<Renderer, JsValue> {
        console_error_panic_hook::set_once();
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let adapter = instance
            .request_adapter(&Default::default())
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let (device, queue) = adapter
            .request_device(&Default::default())
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let mut data: Vec<f32> = Vec::new();
        // Each face uses its own normal and six vertices; cube side is 0.5 m.
        for (normal, u, v) in [
            (Vec3::X, -Vec3::Z, Vec3::Y),
            (-Vec3::X, Vec3::Z, Vec3::Y),
            (Vec3::Y, Vec3::X, -Vec3::Z),
            (-Vec3::Y, Vec3::X, Vec3::Z),
            (Vec3::Z, Vec3::X, Vec3::Y),
            (-Vec3::Z, -Vec3::X, Vec3::Y),
        ] {
            for (x, y) in [
                (-1., -1.),
                (1., -1.),
                (1., 1.),
                (-1., -1.),
                (1., 1.),
                (-1., 1.),
            ] {
                data.extend_from_slice(&((normal + u * x + v * y) * 0.25).to_array());
                data.extend_from_slice(&normal.to_array());
            }
        }
        let vertices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("cube vertices"),
            contents: bytemuck::cast_slice(&data),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("view uniforms"),
            size: 128,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform.as_entire_binding(),
            }],
        });
        Ok(Self {
            device,
            queue,
            vertices,
            vertex_count: 36,
            uniform,
            bind,
            pipeline: None,
            format: None,
        })
    }

    pub fn gpu_device(&self) -> JsValue {
        self.device.as_webgpu().unwrap().clone().into()
    }

    pub fn set_format(&mut self, name: &str) -> Result<(), JsValue> {
        let color = format(name)?;
        if self.format == Some(color) {
            return Ok(());
        }
        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("cube WGSL"),
                source: wgpu::ShaderSource::Wgsl(include_str!("cube.wgsl").into()),
            });
        self.pipeline = Some(
            self.device
                .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("cube pipeline"),
                    layout: None,
                    vertex: wgpu::VertexState {
                        module: &shader,
                        entry_point: Some("vs"),
                        compilation_options: Default::default(),
                        buffers: &[Some(wgpu::VertexBufferLayout {
                            array_stride: 24,
                            step_mode: wgpu::VertexStepMode::Vertex,
                            attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
                        })],
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &shader,
                        entry_point: Some("fs"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format: color,
                            blend: None,
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    primitive: wgpu::PrimitiveState {
                        cull_mode: Some(wgpu::Face::Back),
                        ..Default::default()
                    },
                    depth_stencil: Some(wgpu::DepthStencilState {
                        format: wgpu::TextureFormat::Depth24Plus,
                        depth_write_enabled: Some(true),
                        depth_compare: Some(wgpu::CompareFunction::Less),
                        stencil: Default::default(),
                        bias: Default::default(),
                    }),
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                }),
        );
        // Auto layouts are pipeline-specific, so rebuild the matching bind group.
        self.bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.pipeline.as_ref().unwrap().get_bind_group_layout(0),
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: self.uniform.as_entire_binding(),
            }],
        });
        self.format = Some(color);
        Ok(())
    }

    /// Import browser-owned attachments for this frame only; never destroy them.
    fn attachment(&self, value: JsValue, layer: u32) -> Result<wgpu::TextureView, JsValue> {
        let texture: wgpu::webgpu::GpuTexture = value.unchecked_into();
        let get = |key: &str| js_sys::Reflect::get(texture.as_ref(), &key.into());
        let number = |key: &str| -> Result<u32, JsValue> {
            get(key)?
                .as_f64()
                .map(|n| n as u32)
                .ok_or_else(|| JsValue::from_str(key))
        };
        let name = get("format")?
            .as_string()
            .ok_or_else(|| JsValue::from_str("Missing texture format"))?;
        let wrapped = self.device.create_texture_from_webgpu_handle(
            texture.clone(),
            &wgpu::TextureDescriptor {
                label: None,
                size: wgpu::Extent3d {
                    width: number("width")?,
                    height: number("height")?,
                    depth_or_array_layers: number("depthOrArrayLayers")?,
                },
                mip_level_count: number("mipLevelCount")?,
                sample_count: number("sampleCount")?,
                dimension: wgpu::TextureDimension::D2,
                format: format(&name)?,
                usage: wgpu::TextureUsages::from_bits_truncate(number("usage")?),
                view_formats: &[],
            },
            None,
        );
        Ok(wrapped.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2),
            base_array_layer: layer,
            array_layer_count: Some(1),
            ..Default::default()
        }))
    }

    pub fn draw(
        &self,
        color: JsValue,
        depth: JsValue,
        layer: u32,
        viewport: &[f32],
        projection: &[f32],
        view: &[f32],
        seconds: f32,
    ) -> Result<(), JsValue> {
        if projection.len() != 16 || view.len() != 16 || viewport.len() != 4 {
            return Err(JsValue::from_str("Invalid camera or viewport"));
        }
        let pipeline = self
            .pipeline
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Set format first"))?;
        let model = Mat4::from_translation(Vec3::new(0., 0., -2.))
            * Mat4::from_rotation_y(seconds * 0.3)
            * Mat4::from_rotation_x(0.2 + seconds * 0.15);
        let mvp = Mat4::from_cols_slice(projection) * Mat4::from_cols_slice(view) * model;
        let mut uniforms = [0f32; 32];
        uniforms[..16].copy_from_slice(&mvp.to_cols_array());
        uniforms[16..].copy_from_slice(&model.to_cols_array());
        self.queue
            .write_buffer(&self.uniform, 0, bytemuck::cast_slice(&uniforms));
        let color_view = self.attachment(color, layer)?;
        let depth_view = self.attachment(depth, layer)?;
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("cube eye"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &color_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.025,
                            g: 0.045,
                            b: 0.08,
                            a: 1.,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                ..Default::default()
            });
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, &self.bind, &[]);
            pass.set_vertex_buffer(0, self.vertices.slice(..));
            pass.set_viewport(viewport[0], viewport[1], viewport[2], viewport[3], 0., 1.);
            pass.draw(0..self.vertex_count, 0..1);
        }
        // Submit each view before updating the shared uniform for the next eye.
        self.queue.submit([encoder.finish()]);
        Ok(())
    }
}
