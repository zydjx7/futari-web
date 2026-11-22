import { createPaper } from "./scenes/paper.js";

export { createPaper };
export const packs = {
  paper: { title: "纯净无场景", create: createPaper },
  snow: {
    title: "雪松林生态",
    async create(texture, signal) {
      const { createSnow } = await import("./scenes/snow.js");
      return createSnow(texture, signal);
    }
  }
};
