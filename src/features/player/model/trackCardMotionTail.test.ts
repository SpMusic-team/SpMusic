/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { easingDefinitionToFunction, type Easing } from 'motion'
import { createTrackCardMotionTail } from './trackCardMotionTail.ts'

type Bezier = readonly [number, number, number, number]
const curves: ReadonlyArray<{ name: string; ease: Easing; bezier: Bezier }> = [
  { name: 'linear', ease: 'linear', bezier: [0, 0, 1, 1] },
  { name: 'ease', ease: [.25, .1, .25, 1], bezier: [.25, .1, .25, 1] },
  { name: 'ease-in', ease: [.42, 0, 1, 1], bezier: [.42, 0, 1, 1] },
  { name: 'ease-out', ease: [.0, 0, .58, 1], bezier: [0, 0, .58, 1] },
  { name: 'ease-in-out', ease: [.42, 0, .58, 1], bezier: [.42, 0, .58, 1] },
  { name: 'SpMusic smooth', ease: [.65, 0, .35, 1], bezier: [.65, 0, .35, 1] },
  { name: 'track switch', ease: [.4, 0, .2, 1], bezier: [.4, 0, .2, 1] },
]

// Independent oracle: solve the Bezier parameter in coordinate space, rather
// than finding time by evaluating Motion's easing as the implementation does.
function coordinate(parameter: number, first: number, second: number): number {
  return 3 * (1 - parameter) ** 2 * parameter * first
    + 3 * (1 - parameter) * parameter ** 2 * second + parameter ** 3
}
function parameterAt(value: number, first: number, second: number): number {
  let low = 0, high = 1
  for (let index = 0; index < 60; index += 1) {
    const middle = (low + high) / 2
    if (coordinate(middle, first, second) < value) low = middle
    else high = middle
  }
  return (low + high) / 2
}
function timeAtProgress(progress: number, [x1, y1, x2, y2]: Bezier): number {
  return coordinate(parameterAt(progress, y1, y2), x1, x2)
}
function progressAtTime(time: number, [x1, y1, x2, y2]: Bezier): number {
  return coordinate(parameterAt(time, x1, x2), y1, y2)
}

for (const curve of curves) {
  test(`${curve.name}: partial commits retain the original timeline tail`, () => {
    for (const progress of [.0001, .1, .35, .7, .9, .99]) {
      const startTime = timeAtProgress(progress, curve.bezier)
      for (const fullDuration of [.08, .5, .6]) {
        const result = createTrackCardMotionTail(progress, fullDuration, curve.ease)
        // Motion's own Bezier evaluator uses a 12-step parameter search. Its
        // full-curve error is about .00037; compare our exact oracle within
        // .001 progress and .3ms, rather than demanding unavailable precision.
        assert(Math.abs(result.durationSeconds - fullDuration * (1 - startTime)) < .0003)
        const tailEase = easingDefinitionToFunction(result.ease)
        assert.equal(tailEase(0), 0)
        assert.equal(tailEase(1), 1)
        let previous = 0
        for (const time of [.01, .1, .25, .5, .75, .9, .99]) {
          const value = tailEase(time)
          const expected = progressAtTime(startTime + (1 - startTime) * time, curve.bezier)
          assert(Number.isFinite(value) && value >= previous && value <= 1)
          assert(Math.abs(progress + (1 - progress) * value - expected) < .001,
            JSON.stringify({ curve: curve.name, progress, time, actual: progress + (1 - progress) * value, expected }))
          previous = value
        }
      }
    }
  })
  test(`${curve.name}: full buttons and completed poses preserve safe endpoints`, () => {
    const full = createTrackCardMotionTail(0, .5, curve.ease)
    assert.equal(full.durationSeconds, .5)
    assert.equal(full.ease, curve.ease)
    for (const progress of [1 - 1e-8, 1, 2]) {
      const completed = createTrackCardMotionTail(progress, .5, curve.ease)
      assert.equal(completed.durationSeconds, 0)
      assert(Number.isFinite(easingDefinitionToFunction(completed.ease)(.5)))
    }
    assert.equal(createTrackCardMotionTail(-1, .5, curve.ease).durationSeconds, .5)
  })
}

test('linear keeps constant speed without the former 15% minimum duration', () => {
  const tail = createTrackCardMotionTail(.9, .5, 'linear')
  assert(Math.abs(tail.durationSeconds - .05) < 1e-8)
  const ease = easingDefinitionToFunction(tail.ease)
  assert(Math.abs(ease(.25) - .25) < 1e-8)
  assert(Math.abs(ease(.75) - .75) < 1e-8)
})

test('function easing input has the same tail as the corresponding tuple', () => {
  const ease: Easing = [.4, 0, .2, 1]
  const tuple = createTrackCardMotionTail(.7, .5, ease)
  const callable = createTrackCardMotionTail(.7, .5, easingDefinitionToFunction(ease))
  assert.equal(tuple.durationSeconds, callable.durationSeconds)
  assert.equal(easingDefinitionToFunction(tuple.ease)(.5), easingDefinitionToFunction(callable.ease)(.5))
})
