import { configure } from 'react-native-nitro-h3'

import { MAX_CELL_COUNT } from './engine/cells'

/*
 * Sets the cell ceiling as this module evaluates, which the entry imports before the app.
 *
 * `configure` has to run before the first call that could allocate, and ES imports hoist, so the
 * call cannot sit beside `registerRootComponent` in the entry and still be first.
 */
configure({ maxCellCount: MAX_CELL_COUNT })
