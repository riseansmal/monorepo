module.exports = async (tree, options) => {
  (await import('../src/generate.mjs')).generate(tree, options);
  await (await import('@nx/devkit')).formatFiles(tree);
};
