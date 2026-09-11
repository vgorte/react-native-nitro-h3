const path = require('node:path')

// autolinking reads dependencies off `package.json`, and the package is a symlink from postinstall
module.exports = {
  dependencies: {
    'react-native-nitro-h3': {
      root: path.resolve(__dirname, '..', '..', 'packages', 'react-native-nitro-h3'),
    },
  },
}
