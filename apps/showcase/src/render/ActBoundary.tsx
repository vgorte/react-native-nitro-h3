import { Component, Fragment, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colours, glass, type } from '../theme/tokens'

/** Configures {@linkcode ActBoundary}. */
export interface ActBoundaryProps {
  /** The act's name, as the pager lists it. */
  act: string
  children: ReactNode
}

interface ActBoundaryState {
  /** What the act threw, `null` while it is drawing. */
  error: Error | null
  /** Rises on every retry, so the act below is remounted rather than re-rendered. */
  attempt: number
}

/**
 * Catches what an act throws and offers to bring it back.
 *
 * Several acts do their H3 and Skia work inside a render, so one refusal would otherwise take the
 * whole app down with no way back. The message is shown because it names the call that refused;
 * the stack is left to the console.
 */
export class ActBoundary extends Component<ActBoundaryProps, ActBoundaryState> {
  state: ActBoundaryState = { error: null, attempt: 0 }

  static getDerivedStateFromError(error: unknown): Partial<ActBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  private retry = (): void => {
    this.setState((current) => ({ error: null, attempt: current.attempt + 1 }))
  }

  render(): ReactNode {
    const { act, children } = this.props
    const { error, attempt } = this.state
    // the key carries the retry, so the act is mounted afresh rather than re-rendered as it was
    if (error === null) return <Fragment key={attempt}>{children}</Fragment>

    return (
      <View style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.title}>{act} hit an error</Text>
          <Text style={styles.message}>{error.message}</Text>
          <Pressable style={styles.retry} onPress={this.retry} accessibilityRole="button">
            <Text style={styles.label}>Load the act again</Text>
          </Pressable>
        </View>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colours.ground },
  card: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '38%',
    borderColor: glass.border,
    borderWidth: 1,
    borderRadius: glass.radius,
    backgroundColor: glass.scrim,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 10,
  },
  title: { ...type.value, color: colours.text },
  message: { ...type.label, color: colours.muted },
  retry: {
    alignSelf: 'flex-start',
    borderColor: glass.border,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: glass.fill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 2,
  },
  label: { ...type.label, color: colours.text },
})
