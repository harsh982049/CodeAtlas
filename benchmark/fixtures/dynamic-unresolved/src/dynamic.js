export async function loadPlugin(name) {
  const plugin = await import(`./plugins/${name}.js`);
  return plugin.run();
}
