import { describe, expect, it } from 'vitest'
import { LEGS } from '../../src/legs'
import { isLinkedLeg, LINKED_LEGS, perLinkedLeg } from '../../src/linked-legs'

describe('the linked legs', () => {
  it('lists every leg but λ, in the app’s order', () => {
    expect(LINKED_LEGS).toEqual(LEGS.filter((leg) => leg !== 'lambda'))
  })

  it('answers for each leg as the list does', () => {
    expect(LEGS.filter(isLinkedLeg)).toEqual(LINKED_LEGS)
  })

  it('perLinkedLeg gives each linked leg its own entry, and λ none', () => {
    expect(perLinkedLeg((leg) => `${leg} rows`)).toStrictEqual({ rxm: 'rxm rows', tm: 'tm rows' })
  })
})
