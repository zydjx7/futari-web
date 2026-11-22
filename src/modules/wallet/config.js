export const rewards = Object.freeze({
  chapterCoins: 2,
  puzzleCoins: 3,
  chapterVisibleSeconds: 5,
  companionSecondsPerCoin: 300,
  companionDailyCap: 12,
  companionMaxGapSeconds: 150,
  firstPetCoins: 1,
  returnAfterDays: 3,
  returnCoins: 2,
  satietySecondsPerPoint: 3600,
  feedCooldownSeconds: 3,
  // Use the same midnight for both devices, even when one is travelling.
  dayOffsetSeconds: 9 * 3600
});

// Food is consumed one serving at a time. Furnishings are bought once.
export const shop = {
  hay: { name: "提摩西草", price: 2, nourishment: 12 },
  carrot: { name: "胡萝卜块", price: 3, nourishment: 18 },
  ball: { name: "柳枝球", price: 6, nourishment: 0 },
  bed: { name: "亚麻软窝", price: 12, nourishment: 0 }
};
