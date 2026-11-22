/** Entry point VS Code calls inside the extension host test window. */
exports.run = async function run() {
  const tests = require('./tests.cjs');
  await tests.run();
};
