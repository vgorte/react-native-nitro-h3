import { StyleSheet, Text, View } from 'react-native'
import { EngineCanvas } from '../render/EngineCanvas'
import { type CameraAnchor, useCamera } from '../render/useCamera'
import { colours, type } from '../theme/tokens'
import type { ActProps } from './types'

/** Configures {@linkcode Placeholder}. */
export interface PlaceholderProps extends ActProps {
  name: string
}

const ORIGIN: CameraAnchor = { lat: 0, lng: 0 }

function ignoreSettle(): void {}

/** Holds an act's page on the ground it will be drawn on, naming the act and nothing else. */
export function Placeholder({ name, active }: PlaceholderProps) {
  const camera = useCamera({ anchor: ORIGIN, onSettle: ignoreSettle })

  if (!active) return <View style={styles.root} />

  return (
    <View style={styles.root}>
      <EngineCanvas camera={camera} />
      <Text style={styles.caption}>{name}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colours.ground,
  },
  caption: {
    ...type.label,
    color: colours.muted,
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    textAlign: 'center',
  },
})
