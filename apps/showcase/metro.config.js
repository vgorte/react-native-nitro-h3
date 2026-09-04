const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..', '..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// `apps/example` pins `react-native` 0.87.0, so every importer here resolves this app's own copy.
const pinnedPackages = ['react', 'react-native']
const pinnedOrigin = path.join(projectRoot, 'index.ts')

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isPinned = pinnedPackages.some(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  )
  const resolveContext = isPinned ? { ...context, originModulePath: pinnedOrigin } : context

  return context.resolveRequest(resolveContext, moduleName, platform)
}

module.exports = config
