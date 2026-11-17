import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { relativeDate, relativeDateTime } from '../../src/lib/dates'

// Local time, so the day boundaries match what a person would see.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString()
const NOW = new Date(2026, 10, 17, 15, 30) // Tue 17 Nov 2026, 3:30 PM

describe('friendly dates', () => {
  it('says just now and minutes ago', () => {
    assert.equal(relativeDateTime(new Date(NOW.getTime() - 20_000).toISOString(), NOW), 'Just now')
    assert.equal(relativeDateTime(new Date(NOW.getTime() - 12 * 60_000).toISOString(), NOW), '12 min ago')
    assert.equal(relativeDateTime(new Date(NOW.getTime() + 60_000).toISOString(), NOW), 'Just now', 'a slightly fast clock still reads as now')
  })
  it('uses today and yesterday with the time', () => {
    assert.match(relativeDateTime(at(2026, 11, 17, 9, 5), NOW), /^Today, /)
    assert.match(relativeDateTime(at(2026, 11, 16, 23, 59), NOW), /^Yesterday, /)
    assert.equal(relativeDate(at(2026, 11, 17, 0, 1), NOW), 'Today')
    assert.equal(relativeDate(at(2026, 11, 16, 23, 59), NOW), 'Yesterday')
  })
  it('uses the weekday for the last week and a date after that', () => {
    assert.match(relativeDateTime(at(2026, 11, 13, 10), NOW), /^Friday, /)
    assert.equal(relativeDate(at(2026, 11, 13), NOW), 'Friday')
    assert.match(relativeDate(at(2026, 11, 3), NOW), /^(3 Nov|Nov 3)$/)
    assert.match(relativeDate(at(2025, 3, 9), NOW), /2025/)
  })
  it('drops the time of day for things older than a year', () => {
    assert.ok(!/:/.test(relativeDateTime(at(2025, 3, 9, 14, 2), NOW)))
  })
})
