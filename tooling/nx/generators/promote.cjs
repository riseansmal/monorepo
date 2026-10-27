module.exports = async (tree, options) => {
  const finish = (await import('../src/generate.mjs')).promote(tree, options);
  await (await import('@nx/devkit')).formatFiles(tree);
  return finish;
};
