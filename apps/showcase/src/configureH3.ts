import { configure } from 'react-native-nitro-h3'

import { MAX_CELL_COUNT } from './engine/cells'

// ES imports hoist, so the call cannot sit beside `registerRootComponent` and still run first
configure({ maxCellCount: MAX_CELL_COUNT })
