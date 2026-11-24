use super::{Display, Rect};

// Keep global monitor origins in desktop points. Only offsets inside the chosen
// screen use backing pixels; the web canvas divides these by devicePixelRatio.
#[derive(Clone, Copy, Default)]
#[repr(C)]
pub struct Screen {
    pub frame: [f64; 4],
    pub visible: [f64; 4],
    pub primary_top: f64,
    pub scale: f64,
}
impl Screen {
    pub fn point(&self, x: f64, y: f64) -> (i32, i32) {
        let [left, bottom, _, h] = self.frame;
        let top = bottom + h;
        (
            (left + (x - left) * self.scale).round() as i32,
            (self.primary_top - top + (top - y) * self.scale).round() as i32,
        )
    }
    pub fn cocoa(&self, x: i32, y: i32) -> (f64, f64) {
        let [left, bottom, _, h] = self.frame;
        let top = bottom + h;
        (
            left + (x as f64 - left) / self.scale,
            top - (y as f64 - self.primary_top + top) / self.scale,
        )
    }
    pub fn display(&self) -> Display {
        let rect = |[x, y, w, h]: [f64; 4]| {
            let (x, y) = self.point(x, y + h);
            Rect {
                x,
                y,
                w: (w * self.scale).round() as i32,
                h: (h * self.scale).round() as i32,
            }
        };
        Display {
            screen: rect(self.frame),
            work: rect(self.visible),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn negative_origin_retina_and_dock() {
        for scale in [1., 2.] {
            let s = Screen {
                frame: [-1440., 300., 1440., 900.],
                visible: [-1440., 350., 1440., 825.],
                primary_top: 1080.,
                scale,
            };
            let d = s.display();
            assert_eq!((d.screen.x, d.screen.y), (-1440, -120));
            assert_eq!(d.work.y, -120 + (25. * scale) as i32);
            assert_eq!(d.work.h, (825. * scale) as i32);
            let p = s.point(-1390., 500.);
            assert_eq!(s.cocoa(p.0, p.1), (-1390., 500.));
        }
    }
}
