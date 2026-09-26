/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  playerViewTransitionLayoutId,
  selectPlayerViewTransitionOwnerIds,
  type PlayerViewTransitionLayer,
} from './playerViewTransition.ts'

function layer(id: number, trackId: string, phase: PlayerViewTransitionLayer['phase']): PlayerViewTransitionLayer {
  return { id, trackId, phase }
}

test('A active 与 B preview/incoming 分别拥有唯一身份，B 在晋升前完成预注册', () => {
  const previewOwners = selectPlayerViewTransitionOwnerIds([
    layer(1, 'track-a', 'active'),
    layer(2, 'track-b', 'preview'),
  ])
  const incomingOwners = selectPlayerViewTransitionOwnerIds([
    layer(1, 'track-a', 'active'),
    layer(2, 'track-b', 'incoming'),
  ])

  assert.deepEqual([...previewOwners].sort(), [1, 2])
  assert.deepEqual([...incomingOwners].sort(), [1, 2])
  assert.equal(playerViewTransitionLayoutId('cover', 'track-b'), 'player-view-cover:track-b')
})

test('同一 track.id 的 active 与 incoming 同时存在时只有 incoming 是 owner', () => {
  const owners = selectPlayerViewTransitionOwnerIds([
    layer(10, 'track-b', 'active'),
    layer(11, 'track-b', 'incoming'),
  ])

  assert.deepEqual([...owners], [11])
  assert.equal(owners.has(10), false)
})

test('A→B→A 快速回切时复用的 A exiting 层重新成为唯一 active owner', () => {
  const switchingToB = selectPlayerViewTransitionOwnerIds([
    layer(1, 'track-a', 'exiting'),
    layer(2, 'track-b', 'active'),
  ])
  const returningToA = selectPlayerViewTransitionOwnerIds([
    layer(1, 'track-a', 'active'),
    layer(2, 'track-b', 'exiting'),
    layer(3, 'track-a', 'preview'),
  ])

  assert.deepEqual([...switchingToB].sort(), [1, 2])
  assert.deepEqual([...returningToA].sort(), [1, 2])
  assert.equal(returningToA.has(3), false)
  assert.equal(playerViewTransitionLayoutId('copy', 'track-a'), 'player-view-copy:track-a')
})

test('空 artwork pool 与空当前曲目都不注册共享元素', () => {
  assert.equal(selectPlayerViewTransitionOwnerIds([]).size, 0)
  assert.equal(playerViewTransitionLayoutId('cover', null), undefined)
  assert.equal(playerViewTransitionLayoutId('copy', undefined), undefined)
})
