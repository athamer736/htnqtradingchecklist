// electron-builder afterPack hook: switches off Electron features the installed app never uses but
// that would let another program run its own code inside it (and so read the lesson pages or turn
// off the watermark checks):
//   RunAsNode                            ELECTRON_RUN_AS_NODE=1 turns the app into plain Node.js
//   EnableNodeOptionsEnvironmentVariable NODE_OPTIONS=--require ... loads extra code at start
//   EnableNodeCliInspectArguments        --inspect opens a debugger on the main process
//   OnlyLoadAppFromAsar                  a "resources/app" folder can't stand in for the app
// The renderer's DevTools and --remote-debugging-port are handled in src/main/index.ts.

const path = require('path')
const { flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    throw new Error(`afterPack: fuses are only set up for Windows builds, not ${context.electronPlatformName}`)
  }
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  })
}
