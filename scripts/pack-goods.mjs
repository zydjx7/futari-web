import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// Pillow preserves transparent edges when the illustrator supplies an oversized original.
execFileSync(
  process.env.PYTHON || "python",
  [
    "-c",
    `
from pathlib import Path
from PIL import Image
folder = Path("outputs/绘本兔窝/新道具单图")
atlas = Image.new("RGBA", (1024, 768))
for index, name in enumerate("dandelion apple strawberry applewood bell toastbed knitbed mat teaset lantern".split()):
    with Image.open(folder / (name + ".png")) as source:
        icon = source.convert("RGBA")
        if icon.getchannel("A").getextrema() != (0, 255):
            raise ValueError(name + ": transparent PNG required")
        icon.thumbnail((256, 256), Image.Resampling.LANCZOS)
        atlas.paste(icon, (index % 4 * 256 + (256 - icon.width)//2, index // 4 * 256 + (256 - icon.height)//2))
atlas.save("src/modules/rabbit/art/goods.webp", lossless=True)
`,
  ],
  { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit" },
);
