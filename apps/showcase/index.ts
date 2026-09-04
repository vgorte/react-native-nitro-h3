import { registerRootComponent } from 'expo'
import { configure } from 'react-native-nitro-h3'

import App from './src/App'
import { MAX_CELL_COUNT } from './src/engine/cells'

configure({ maxCellCount: MAX_CELL_COUNT })

registerRootComponent(App)
