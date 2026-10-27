module.exports = {
  getReleaseLine: async (changeset, type) => {
    const title = /^# (.+)$/m.exec(changeset.summary)?.[1];
    return `- ${type}: ${title ?? changeset.id}`;
  },
  getDependencyReleaseLine: async (_changesets, dependencies) =>
    dependencies.length
      ? `- updated internal dependencies: ${dependencies.map((p) => `${p.name}@${p.newVersion}`).join(', ')}`
      : '',
};
