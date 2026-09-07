import { useFonts } from 'expo-font'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import PagerView from 'react-native-pager-view'
import { Atlas } from './acts/Atlas'
import { Engine } from './acts/Engine'
import { FractalCity } from './acts/FractalCity'
import { Heatmap } from './acts/Heatmap'
import { MagneticGrid } from './acts/MagneticGrid'
import { Trail } from './acts/Trail'
import type { ActProps } from './acts/types'
import { ActBoundary } from './render/ActBoundary'
import { resetWorstGap } from './render/BlockedReadout'
import { ActIndicator } from './render/hud/ActIndicator'
import { Inspector } from './render/Inspector'
import { fontAssets } from './theme/fonts'
import { colours } from './theme/tokens'

/** Names the acts in the order they are paged through. */
export const ACTS = [
  'Atlas',
  'Engine',
  'Fractal city',
  'Magnetic grid',
  'Heatmap',
  'Trail',
] as const

const PAGES: ((props: ActProps) => React.JSX.Element)[] = [
  Atlas,
  Engine,
  FractalCity,
  MagneticGrid,
  Heatmap,
  Trail,
]

export default function App() {
  const [fontsLoaded] = useFonts(fontAssets)
  const pager = useRef<PagerView>(null)
  const [current, setCurrent] = useState(0)
  // the cell the Inspector stands on, which the act it was opened from highlights
  const [inspected, setInspected] = useState<bigint | null>(null)

  // the page follows the pager, so the outgoing act keeps drawing
  const select = useCallback((index: number) => {
    pager.current?.setPage(index)
  }, [])

  const closeInspector = useCallback(() => setInspected(null), [])

  // an unstyled first frame is worse than the bare ground
  if (!fontsLoaded) return <View style={styles.root} />

  return (
    <GestureHandlerRootView style={styles.root}>
      {/* every act owns a full-screen pan, so the pager never scrolls */}
      <PagerView
        ref={pager}
        style={StyleSheet.absoluteFill}
        initialPage={0}
        scrollEnabled={false}
        onPageSelected={(event) => {
          setCurrent(event.nativeEvent.position)
          // the worst gap belongs to the act that caused it
          resetWorstGap()
        }}
      >
        {PAGES.map((Act, index) => (
          <View key={ACTS[index]} style={styles.page} collapsable={false}>
            <ActBoundary act={ACTS[index]}>
              <Act
                active={current === index}
                inspected={current === index ? inspected : null}
                onInspect={setInspected}
              />
            </ActBoundary>
          </View>
        ))}
      </PagerView>
      <ActIndicator acts={ACTS} current={current} onSelect={select} />
      {/* the sheet stands over every act and over the indicator, which its backdrop covers */}
      <Inspector cell={inspected} onClose={closeInspector} />
      <StatusBar style="light" />
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colours.ground,
  },
  page: {
    flex: 1,
  },
})
