export async function loadGraph() {
  process.env.NX_DAEMON = 'false';
  const { createProjectGraphAsync } = await import('@nx/devkit');
  return createProjectGraphAsync();
}
