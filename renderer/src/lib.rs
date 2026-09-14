use glam::{Mat4, Quat, Vec3};
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
    layout: wgpu::BindGroupLayout,
    cloud: Option<wgpu::Buffer>,
    cloud_count: u32,
    lines: Option<wgpu::Buffer>,
    line_count: u32,
    point_pipeline: Option<wgpu::RenderPipeline>,
    line_pipeline: Option<wgpu::RenderPipeline>,
    feedback: wgpu::Buffer,
    feedback_count: u32,
    shell_pipeline: Option<wgpu::RenderPipeline>,
    feedback_uniform: wgpu::Buffer,
    feedback_bind: wgpu::BindGroup,
    menu: wgpu::Buffer,
    menu_count: u32,
    menu_layout: wgpu::BindGroupLayout,
    menu_bind: Option<wgpu::BindGroup>,
    menu_pipeline: Option<wgpu::RenderPipeline>,
    hud: wgpu::Buffer,
    hud_count: u32,
    hud_pipeline: Option<wgpu::RenderPipeline>,
    hud_uniform: wgpu::Buffer,
    hud_bind: wgpu::BindGroup,
    yaw: f32,
    pitch: f32,
    distance: f32,
    offset: Vec3,
    grab_rotation: Quat,
    scale: f32,
    depth_data: Option<Vec<f32>>,
    depth_range: (f32, f32),
    depth_spread: f32,
    grad_data: Option<Vec<f32>>,
    rotated_data: Option<Vec<f32>>,
    base_lines: Vec<f32>,
}

const WIDTH: f32 = 518.0;
const HEIGHT: f32 = 392.0;

fn display_z(d: f32, range: (f32, f32), spread: f32) -> f32 {
    let denom = (range.1 - range.0).max(1e-6);
    let t = ((d - range.0) / denom).clamp(0.0, 1.0);
    0.06f32.max(2.0 + spread * (-0.5 + 1.72 * t))
}

fn point_at(x: f32, y: f32, d: f32, range: (f32, f32), spread: f32) -> [f32; 3] {
    let z = display_z(d, range, spread);
    let focal = WIDTH / (2.0 * (std::f32::consts::PI / 6.0).tan());
    [
        (x - (WIDTH - 1.0) / 2.0) * z / focal,
        ((HEIGHT - 1.0) / 2.0 - y) * z / focal,
        2.0 - z,
    ]
}

fn depth_from_z(pz: f32, range: (f32, f32), spread: f32) -> Option<f32> {
    let (lo, hi) = range;
    if !lo.is_finite() || !hi.is_finite() || hi <= lo {
        return None;
    }
    let t = ((0.5 - pz / spread.max(1e-6)) / 1.72).clamp(0.0, 1.0);
    Some(lo + t * (hi - lo))
}

fn marching_squares_contour(
    depth: &[f32],
    range: (f32, f32),
    spread: f32,
    level: f32,
    step: usize,
) -> (Vec<f32>, Vec<[f32; 6]>) {
    let mut lines = Vec::new();
    let mut segments = Vec::new();
    let width = 518;
    let height = 392;
    let s = step.max(1);
    let color = [0.2f32, 0.85, 0.95];

    let interp = |val_a: f32, val_b: f32, pos_a: f32, pos_b: f32| -> f32 {
        let denom = val_b - val_a;
        let t = if denom.abs() > 1e-6 {
            ((level - val_a) / denom).clamp(0.0, 1.0)
        } else {
            0.5
        };
        pos_a + t * (pos_b - pos_a)
    };

    for y in (0..height - s).step_by(s) {
        for x in (0..width - s).step_by(s) {
            let i0 = y * width + x;
            let i1 = y * width + (x + s);
            let i2 = (y + s) * width + (x + s);
            let i3 = (y + s) * width + x;

            let v0 = depth[i0];
            let v1 = depth[i1];
            let v2 = depth[i2];
            let v3 = depth[i3];

            if !v0.is_finite() || !v1.is_finite() || !v2.is_finite() || !v3.is_finite() {
                continue;
            }
            if v0 <= 0.0 || v1 <= 0.0 || v2 <= 0.0 || v3 <= 0.0 {
                continue;
            }

            let min_v = v0.min(v1).min(v2).min(v3);
            let max_v = v0.max(v1).max(v2).max(v3);
            if level < min_v || level > max_v {
                continue;
            }

            let mut mask = 0u8;
            if v0 >= level { mask |= 1; }
            if v1 >= level { mask |= 2; }
            if v2 >= level { mask |= 4; }
            if v3 >= level { mask |= 8; }

            if mask == 0 || mask == 15 {
                continue;
            }

            let edge_pt = |edge: u8| -> (f32, f32) {
                match edge {
                    0 => (interp(v0, v1, x as f32, (x + s) as f32), y as f32),
                    1 => ((x + s) as f32, interp(v1, v2, y as f32, (y + s) as f32)),
                    2 => (interp(v3, v2, x as f32, (x + s) as f32), (y + s) as f32),
                    _ => (x as f32, interp(v0, v3, y as f32, (y + s) as f32)),
                }
            };

            let line_pairs: &[(u8, u8)] = match mask {
                1 | 14 => &[(3, 0)],
                2 | 13 => &[(0, 1)],
                3 | 12 => &[(3, 1)],
                4 | 11 => &[(1, 2)],
                5 => &[(3, 0), (1, 2)],
                6 | 9 => &[(0, 2)],
                7 | 8 => &[(3, 2)],
                10 => &[(0, 1), (2, 3)],
                _ => &[],
            };

            for &(e0, e1) in line_pairs {
                let (px_a, py_a) = edge_pt(e0);
                let (px_b, py_b) = edge_pt(e1);
                let p_a = point_at(px_a, py_a, level, range, spread);
                let p_b = point_at(px_b, py_b, level, range, spread);
                lines.extend_from_slice(&[
                    p_a[0], p_a[1], p_a[2], color[0], color[1], color[2],
                    p_b[0], p_b[1], p_b[2], color[0], color[1], color[2],
                ]);
                segments.push([p_a[0], p_a[1], p_a[2], p_b[0], p_b[1], p_b[2]]);
            }
        }
    }
    (lines, segments)
}

fn closest_point_on_segments(segments: &[[f32; 6]], point: [f32; 3]) -> Option<[f32; 3]> {
    if segments.is_empty() {
        return None;
    }
    let [px, py, pz] = point;
    let mut best_dist_sq = f32::INFINITY;
    let mut best_pt = None;

    for s in segments {
        let [ax, ay, az, bx, by, bz] = *s;
        let dx = bx - ax;
        let dy = by - ay;
        let dz = bz - az;
        let len_sq = dx * dx + dy * dy + dz * dz;
        let u = if len_sq > 1e-12 {
            (((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len_sq).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let cx = ax + u * dx;
        let cy = ay + u * dy;
        let cz = az + u * dz;
        let dist_sq = (px - cx) * (px - cx) + (py - cy) * (py - cy) + (pz - cz) * (pz - cz);
        if dist_sq < best_dist_sq {
            best_dist_sq = dist_sq;
            best_pt = Some([cx, cy, cz]);
        }
    }
    best_pt
}

fn append_arrow(
    out: &mut Vec<f32>,
    start: [f32; 3],
    dir: [f32; 3],
    len: f32,
    color: [f32; 3],
) {
    let [sx, sy, sz] = start;
    let [dx, dy, dz] = dir;
    let tip = [sx + len * dx, sy + len * dy, sz + len * dz];

    // Stem: start -> tip
    out.extend_from_slice(&[
        sx, sy, sz, color[0], color[1], color[2],
        tip[0], tip[1], tip[2], color[0], color[1], color[2],
    ]);

    // Barbs at tip
    let barb_len = len * 0.25;
    let cos_a = 0.8660254f32; // cos(30 deg)
    let sin_a = 0.5f32;       // sin(30 deg)
    let perp = [-dy, dx, 0.0];

    let b1_x = tip[0] - barb_len * (dx * cos_a - perp[0] * sin_a);
    let b1_y = tip[1] - barb_len * (dy * cos_a - perp[1] * sin_a);
    let b1_z = tip[2] - barb_len * (dz * cos_a - perp[2] * sin_a);

    let b2_x = tip[0] - barb_len * (dx * cos_a + perp[0] * sin_a);
    let b2_y = tip[1] - barb_len * (dy * cos_a + perp[1] * sin_a);
    let b2_z = tip[2] - barb_len * (dz * cos_a + perp[2] * sin_a);

    out.extend_from_slice(&[
        tip[0], tip[1], tip[2], color[0], color[1], color[2],
        b1_x, b1_y, b1_z, color[0], color[1], color[2],
        tip[0], tip[1], tip[2], color[0], color[1], color[2],
        b2_x, b2_y, b2_z, color[0], color[1], color[2],
    ]);
}

fn curvature_vector_lines(
    closest: [f32; 3],
    grad: &[f32],
    rotated: &[f32],
    arrow_len: f32,
) -> Vec<f32> {
    let [cx, cy, cz] = closest;
    let z = 2.0 - cz;
    if z <= 0.05 {
        return Vec::new();
    }
    let focal = WIDTH / (2.0 * (std::f32::consts::PI / 6.0).tan());
    let x = cx * focal / z + (WIDTH - 1.0) / 2.0;
    let y = (HEIGHT - 1.0) / 2.0 - cy * focal / z;
    if !x.is_finite() || !y.is_finite() || x < 0.0 || x >= WIDTH || y < 0.0 || y >= HEIGHT {
        return Vec::new();
    }

    let x0 = (x.floor() as usize).min(WIDTH as usize - 1);
    let x1 = (x0 + 1).min(WIDTH as usize - 1);
    let fx = x - x0 as f32;

    let y0 = (y.floor() as usize).min(HEIGHT as usize - 1);
    let y1 = (y0 + 1).min(HEIGHT as usize - 1);
    let fy = y - y0 as f32;

    let sample_2d = |data: &[f32], stride: usize, offset: usize| -> f32 {
        let i00 = (y0 * (WIDTH as usize) + x0) * stride + offset;
        let i01 = (y0 * (WIDTH as usize) + x1) * stride + offset;
        let i10 = (y1 * (WIDTH as usize) + x0) * stride + offset;
        let i11 = (y1 * (WIDTH as usize) + x1) * stride + offset;
        (data[i00] * (1.0 - fx) + data[i01] * fx) * (1.0 - fy)
            + (data[i10] * (1.0 - fx) + data[i11] * fx) * fy
    };

    let gy = sample_2d(grad, 2, 0);
    let gx = sample_2d(grad, 2, 1);
    let g_norm = (gx * gx + gy * gy).sqrt();
    if g_norm <= 1e-12 {
        return Vec::new();
    }
    let b0_x = gx / g_norm;
    let b0_y = gy / g_norm;

    let da2 = sample_2d(rotated, 4, 0);
    let db2 = sample_2d(rotated, 4, 3);
    let diag_norm = (da2 * da2 + db2 * db2).sqrt();

    let mut out = Vec::new();

    // Vector 1: Normalized 2D direction of the gradient in 3D: [b0_x, -b0_y, 0.0]
    append_arrow(&mut out, closest, [b0_x, -b0_y, 0.0], arrow_len, [0.2, 1.0, 0.3]);

    // Vector 2: Diagonal terms in rotated as a single normalized vector with respect to rotated gradient
    if diag_norm > 1e-12 {
        let w0 = da2 / diag_norm;
        let w1 = db2 / diag_norm;
        let v2_x = w0 * b0_x + w1 * b0_y;
        let v2_y = w0 * b0_y - w1 * b0_x;
        append_arrow(&mut out, closest, [v2_x, -v2_y, 0.0], arrow_len, [1.0, 0.25, 0.75]);
    }

    out
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
        let feedback = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("grab feedback vertices"),
            size: 131072,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let feedback_uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("grab feedback world transform"),
            size: 128,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let feedback_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("grab feedback"),
            layout: &layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: feedback_uniform.as_entire_binding(),
            }],
        });
        let hud = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("hud vertices"),
            size: 65536,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let hud_uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("hud view transform"),
            size: 128,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let hud_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("hud overlay"),
            layout: &layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: hud_uniform.as_entire_binding(),
            }],
        });
        let menu = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("context menu quad"), size: 120,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let menu_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("menu texture layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
            ],
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
            layout,
            cloud: None,
            cloud_count: 0,
            lines: None,
            line_count: 0,
            point_pipeline: None,
            line_pipeline: None,
            feedback,
            feedback_count: 0,
            shell_pipeline: None,
            feedback_uniform,
            feedback_bind,
            menu, menu_count: 0, menu_layout, menu_bind: None, menu_pipeline: None,
            hud,
            hud_count: 0,
            hud_pipeline: None,
            hud_uniform,
            hud_bind,
            yaw: 0.,
            pitch: 0.,
            distance: 2.,
            offset: Vec3::ZERO,
            grab_rotation: Quat::IDENTITY,
            scale: 1.,
            depth_data: None,
            depth_range: (0.0, 1.0),
            depth_spread: 1.0,
            grad_data: None,
            rotated_data: None,
            base_lines: Vec::new(),
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
        let pipeline_layout = self
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[Some(&self.layout)],
                immediate_size: 0,
            });
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
                    layout: Some(&pipeline_layout),
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
        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("cloud shader"),
                source: wgpu::ShaderSource::Wgsl(include_str!("cloud.wgsl").into()),
            });
        for kind in 0..4 {
            let is_point = kind == 0;
            let _is_line = kind == 1;
            let is_shell = kind == 2;
            let is_hud = kind == 3;
            let rgb_attributes = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3];
            let rgba_attributes = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x4];
            let point_attributes = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x4];
            let pipeline = self
                .device
                .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(if is_point {
                        "point splats"
                    } else if is_shell {
                        "grab feedback"
                    } else if is_hud {
                        "hud overlay"
                    } else {
                        "detection annotations"
                    }),
                    layout: Some(&pipeline_layout),
                    vertex: wgpu::VertexState {
                        module: &shader,
                        entry_point: Some(if is_point { "point" } else if is_shell || is_hud { "shell" } else { "line" }),
                        compilation_options: Default::default(),
                        buffers: &[Some(wgpu::VertexBufferLayout {
                            array_stride: if is_point { 40 } else if is_shell || is_hud { 28 } else { 24 },
                            step_mode: if is_point {
                                wgpu::VertexStepMode::Instance
                            } else {
                                wgpu::VertexStepMode::Vertex
                            },
                            attributes: if is_point {
                                &point_attributes
                            } else if is_shell || is_hud {
                                &rgba_attributes
                            } else {
                                &rgb_attributes
                            },
                        })],
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &shader,
                        entry_point: Some(if is_point { "point_color" } else if is_shell || is_hud { "shell_color" } else { "color" }),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format: color,
                            blend: if is_point || is_shell || is_hud { Some(wgpu::BlendState::ALPHA_BLENDING) } else { None },
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    primitive: wgpu::PrimitiveState {
                        cull_mode: None,
                        topology: if is_point || is_shell || is_hud {
                            wgpu::PrimitiveTopology::TriangleList
                        } else {
                            wgpu::PrimitiveTopology::LineList
                        },
                        ..Default::default()
                    },
                    depth_stencil: Some(wgpu::DepthStencilState {
                        format: wgpu::TextureFormat::Depth24Plus,
                        depth_write_enabled: Some(is_point),
                        depth_compare: Some(if is_point {
                            wgpu::CompareFunction::LessEqual
                        } else {
                            wgpu::CompareFunction::Always
                        }),
                        stencil: Default::default(),
                        bias: Default::default(),
                    }),
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                });
            if is_hud {
                self.hud_pipeline = Some(pipeline);
            } else if is_shell {
                self.shell_pipeline = Some(pipeline);
            } else if is_point {
                self.point_pipeline = Some(pipeline);
            } else {
                self.line_pipeline = Some(pipeline);
            }
        }
        let menu_shader = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("menu WGSL"), source: wgpu::ShaderSource::Wgsl(include_str!("menu.wgsl").into()),
        });
        let menu_pipeline_layout = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("menu pipeline layout"), bind_group_layouts: &[Some(&self.layout), Some(&self.menu_layout)], immediate_size: 0,
        });
        self.menu_pipeline = Some(self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("context menu"), layout: Some(&menu_pipeline_layout),
            vertex: wgpu::VertexState { module: &menu_shader, entry_point: Some("vs"), compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout { array_stride: 20, step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x2] })] },
            fragment: Some(wgpu::FragmentState { module: &menu_shader, entry_point: Some("fs"), compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format: color, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })] }),
            primitive: Default::default(),
            depth_stencil: Some(wgpu::DepthStencilState { format: wgpu::TextureFormat::Depth24Plus,
                depth_write_enabled: Some(false), depth_compare: Some(wgpu::CompareFunction::Always), stencil: Default::default(), bias: Default::default() }),
            multisample: Default::default(), multiview_mask: None, cache: None,
        }));
        self.format = Some(color);
        Ok(())
    }

    pub fn set_cloud(&mut self, points: &[f32]) -> Result<(), JsValue> {
        if points.is_empty() {
            self.cloud = None;
            self.cloud_count = 0;
            return Ok(());
        }
        if !points.iter().all(|x| x.is_finite()) {
            return Err(JsValue::from_str("Invalid cloud vertices"));
        }
        if points.len() % 10 == 0 && points.len() <= 518 * 392 * 10 {
            self.cloud = Some(
                self.device
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("uploaded cloud"),
                        contents: bytemuck::cast_slice(points),
                        usage: wgpu::BufferUsages::VERTEX,
                    }),
            );
            self.cloud_count = (points.len() / 10) as u32;
            return Ok(());
        }
        if points.len() % 6 == 0 && points.len() <= 518 * 392 * 6 {
            let count = points.len() / 6;
            let mut expanded = Vec::with_capacity(count * 10);
            for i in 0..count {
                let base = i * 6;
                expanded.extend_from_slice(&points[base..base + 6]);
                expanded.extend_from_slice(&[0.0, 0.0, 0.0, 0.0]);
            }
            self.cloud = Some(
                self.device
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("uploaded cloud"),
                        contents: bytemuck::cast_slice(&expanded),
                        usage: wgpu::BufferUsages::VERTEX,
                    }),
            );
            self.cloud_count = count as u32;
            return Ok(());
        }
        Err(JsValue::from_str("Invalid cloud vertices stride; expected 10 or 6 floats per point"))
    }
    pub fn set_lines(&mut self, lines: &[f32]) -> Result<(), JsValue> {
        if lines.len() % 12 != 0
            || lines.len() > (8 * 3 * 64 + 65536) * 12
            || !lines.iter().all(|x| x.is_finite())
        {
            return Err(JsValue::from_str("Invalid annotation vertices"));
        }
        self.base_lines = lines.to_vec();
        self.line_count = (lines.len() / 6) as u32;
        self.lines = if lines.is_empty() {
            None
        } else {
            Some(
                self.device
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("uploaded lines"),
                        contents: bytemuck::cast_slice(lines),
                        usage: wgpu::BufferUsages::VERTEX,
                    }),
            )
        };
        Ok(())
    }
    /// RGBA triangle vertices in XR local space, independent of the cloud transform.
    pub fn set_grab_feedback(&mut self, vertices: &[f32]) -> Result<(), JsValue> {
        if vertices.len() % 21 != 0 || vertices.len() * 4 > 131072
            || !vertices.iter().all(|v| v.is_finite()) {
            return Err(JsValue::from_str("Invalid grab feedback vertices"));
        }
        self.feedback_count = (vertices.len() / 7) as u32;
        if !vertices.is_empty() {
            self.queue.write_buffer(&self.feedback, 0, bytemuck::cast_slice(vertices));
        }
        Ok(())
    }

    pub fn set_menu_texture(&mut self, pixels: &[u8], width: u32, height: u32) -> Result<(), JsValue> {
        if width == 0 || height == 0 || width > 2048 || height > 2048 || pixels.len() != (width * height * 4) as usize {
            return Err(JsValue::from_str("Invalid menu texture"));
        }
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("JavaScript menu texture"), size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm, usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST, view_formats: &[],
        });
        self.queue.write_texture(wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            pixels, wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width * 4), rows_per_image: Some(height) },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 });
        let view = texture.create_view(&Default::default());
        let sampler = self.device.create_sampler(&wgpu::SamplerDescriptor { mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, ..Default::default() });
        self.menu_bind = Some(self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("context menu texture"), layout: &self.menu_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&sampler) }],
        }));
        Ok(())
    }

    pub fn set_menu(&mut self, vertices: &[f32]) -> Result<(), JsValue> {
        if (!vertices.is_empty() && vertices.len() != 30) || !vertices.iter().all(|v| v.is_finite()) {
            return Err(JsValue::from_str("Invalid menu quad"));
        }
        self.menu_count = (vertices.len() / 5) as u32;
        if !vertices.is_empty() { self.queue.write_buffer(&self.menu, 0, bytemuck::cast_slice(vertices)); }
        Ok(())
    }

    /// RGBA triangle vertices in view space (eye space), projected directly with projection matrix.
    pub fn set_hud(&mut self, vertices: &[f32]) -> Result<(), JsValue> {
        if vertices.len() % 21 != 0 || vertices.len() * 4 > 65536
            || !vertices.iter().all(|v| v.is_finite()) {
            return Err(JsValue::from_str("Invalid HUD vertices"));
        }
        self.hud_count = (vertices.len() / 7) as u32;
        if !vertices.is_empty() {
            self.queue.write_buffer(&self.hud, 0, bytemuck::cast_slice(vertices));
        }
        Ok(())
    }

    pub fn set_pose(&mut self, yaw: f32, pitch: f32, distance: f32) {
        if [yaw, pitch, distance].iter().all(|v| v.is_finite()) {
            self.yaw = yaw;
            self.pitch = pitch;
            self.distance = distance;
        }
    }

    pub fn set_grab(&mut self, x: f32, y: f32, z: f32, scale: f32) {
        if [x, y, z, scale].iter().all(|v| v.is_finite()) {
            self.offset = Vec3::new(x, y, z);
            self.scale = scale.clamp(0.1, 10.);
        }
    }

    pub fn set_grab_rotation(&mut self, q: &[f32]) {
        if q.len() == 4 && q.iter().all(|v| v.is_finite()) {
            let rotation = Quat::from_xyzw(q[0], q[1], q[2], q[3]);
            if rotation.length_squared() > 0.0001 {
                self.grab_rotation = rotation.normalize();
            }
        }
    }

    pub fn set_depth_map(&mut self, depth: &[f32], min_depth: f32, max_depth: f32, spread: f32) {
        if depth.len() == 518 * 392 && min_depth.is_finite() && max_depth.is_finite() && max_depth > min_depth {
            self.depth_data = Some(depth.to_vec());
            self.depth_range = (min_depth, max_depth);
            self.depth_spread = if spread.is_finite() && spread > 0.0 { spread } else { 1.0 };
        }
    }

    pub fn set_spread(&mut self, spread: f32) {
        if spread.is_finite() && spread > 0.0 {
            self.depth_spread = spread;
        }
    }

    pub fn set_curvature(&mut self, grad: &[f32], rotated: &[f32]) {
        if grad.len() == (WIDTH * HEIGHT * 2.0) as usize && rotated.len() == (WIDTH * HEIGHT * 4.0) as usize {
            self.grad_data = Some(grad.to_vec());
            self.rotated_data = Some(rotated.to_vec());
        }
    }

    pub fn update_grab_level_curve(&mut self, mx: f32, my: f32, mz: f32) -> Option<Vec<f32>> {
        let depth = self.depth_data.as_ref()?;
        let level = depth_from_z(mz, self.depth_range, self.depth_spread)?;
        let (contour_lines, segments) = marching_squares_contour(
            depth,
            self.depth_range,
            self.depth_spread,
            level,
            2,
        );
        let closest = closest_point_on_segments(&segments, [mx, my, mz])?;
        let mut combined = self.base_lines.clone();
        combined.extend_from_slice(&contour_lines);

        if let (Some(grad), Some(rotated)) = (self.grad_data.as_ref(), self.rotated_data.as_ref()) {
            let vector_lines = curvature_vector_lines(closest, grad, rotated, 0.08);
            combined.extend_from_slice(&vector_lines);
        }

        if !combined.is_empty() {
            self.lines = Some(
                self.device
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("uploaded lines with level curve and vectors"),
                        contents: bytemuck::cast_slice(&combined),
                        usage: wgpu::BufferUsages::VERTEX,
                    }),
            );
            self.line_count = (combined.len() / 6) as u32;
        }
        Some(vec![closest[0], closest[1], closest[2]])
    }

    pub fn clear_grab_level_curve(&mut self) {
        if self.base_lines.is_empty() {
            self.lines = None;
            self.line_count = 0;
        } else {
            self.lines = Some(
                self.device
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("restored base lines"),
                        contents: bytemuck::cast_slice(&self.base_lines),
                        usage: wgpu::BufferUsages::VERTEX,
                    }),
            );
            self.line_count = (self.base_lines.len() / 6) as u32;
        }
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
        let model = if self.cloud.is_some() {
            Mat4::from_translation(Vec3::new(0., 0., -self.distance) + self.offset)
                * Mat4::from_quat(self.grab_rotation)
                * Mat4::from_rotation_y(self.yaw)
                * Mat4::from_rotation_x(self.pitch)
                * Mat4::from_scale(Vec3::splat(self.scale))
        } else {
            Mat4::from_translation(Vec3::new(0., 0., -2.))
                * Mat4::from_rotation_y(seconds * 0.3)
                * Mat4::from_rotation_x(0.2 + seconds * 0.15)
        };
        let mvp = Mat4::from_cols_slice(projection) * Mat4::from_cols_slice(view) * model;
        let mut uniforms = [0f32; 32];
        uniforms[..16].copy_from_slice(&mvp.to_cols_array());
        uniforms[16..].copy_from_slice(&model.to_cols_array());
        self.queue
            .write_buffer(&self.uniform, 0, bytemuck::cast_slice(&uniforms));
        let world_mvp = Mat4::from_cols_slice(projection) * Mat4::from_cols_slice(view);
        uniforms[..16].copy_from_slice(&world_mvp.to_cols_array());
        uniforms[16..].copy_from_slice(&Mat4::IDENTITY.to_cols_array());
        self.queue.write_buffer(&self.feedback_uniform, 0, bytemuck::cast_slice(&uniforms));
        let hud_mvp = Mat4::from_cols_slice(projection);
        uniforms[..16].copy_from_slice(&hud_mvp.to_cols_array());
        uniforms[16..].copy_from_slice(&Mat4::IDENTITY.to_cols_array());
        self.queue.write_buffer(&self.hud_uniform, 0, bytemuck::cast_slice(&uniforms));
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
            pass.set_bind_group(0, &self.bind, &[]);
            pass.set_viewport(viewport[0], viewport[1], viewport[2], viewport[3], 0., 1.);
            if let Some(cloud) = &self.cloud {
                pass.set_pipeline(self.point_pipeline.as_ref().unwrap());
                pass.set_vertex_buffer(0, cloud.slice(..));
                pass.draw(0..6, 0..self.cloud_count);
                if let Some(lines) = &self.lines {
                    pass.set_pipeline(self.line_pipeline.as_ref().unwrap());
                    pass.set_vertex_buffer(0, lines.slice(..));
                    pass.draw(0..self.line_count, 0..1);
                }
            } else {
                pass.set_pipeline(pipeline);
                pass.set_vertex_buffer(0, self.vertices.slice(..));
                pass.draw(0..self.vertex_count, 0..1);
            }
            if self.feedback_count > 0 {
                pass.set_bind_group(0, &self.feedback_bind, &[]);
                pass.set_vertex_buffer(0, self.feedback.slice(..));
                pass.set_pipeline(self.shell_pipeline.as_ref().unwrap());
                pass.draw(0..self.feedback_count, 0..1);
            }
            if self.menu_count > 0 {
                if let Some(bind) = &self.menu_bind {
                    pass.set_pipeline(self.menu_pipeline.as_ref().unwrap());
                    pass.set_bind_group(0, &self.feedback_bind, &[]);
                    pass.set_bind_group(1, bind, &[]);
                    pass.set_vertex_buffer(0, self.menu.slice(..));
                    pass.draw(0..self.menu_count, 0..1);
                }
            }
            if self.hud_count > 0 {
                pass.set_bind_group(0, &self.hud_bind, &[]);
                pass.set_vertex_buffer(0, self.hud.slice(..));
                pass.set_pipeline(self.hud_pipeline.as_ref().unwrap());
                pass.draw(0..self.hud_count, 0..1);
            }
        }
        // Submit each view before updating the shared uniform for the next eye.
        self.queue.submit([encoder.finish()]);
        Ok(())
    }
}
