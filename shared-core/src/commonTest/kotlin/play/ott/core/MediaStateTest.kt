package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class MediaStateTest {
    private fun record(id: String = "episode-7", url: String = "expired", source: String = "account-a", position: Double = 125.9) = MediaRecord(MediaRef(source, id), url, position)
    @Test fun renewedUrlRetainsResumeAndFavoriteWhileMetadataRefreshes() {
        val old = record()
        val changed = MediaState.change(MediaCollection(listOf(old), listOf(old)), MediaMutation.VISIT, record(url = "renewed", position = 0.0), 20)
        assertEquals("renewed", changed.history.single().payload)
        assertEquals(125.9, changed.history.single().position)
        assertEquals(changed.history, changed.favorites)
        assertEquals(120.0, MediaState.resume(changed.history.single().position, 60.0))
    }
    @Test fun sourceBoundariesAndDifferentEpisodesNeverSharePositions() {
        val changed = MediaState.change(MediaCollection(listOf(record(), record(id = "episode-8")), emptyList()), MediaMutation.VISIT, record(source = "account-b", position = 0.0), 20)
        assertEquals(1, changed.history.size)
        assertEquals(0.0, changed.history.single().position)
        val two = MediaState.change(MediaCollection(listOf(record()), emptyList()), MediaMutation.VISIT, record(id = "episode-8", position = 0.0), 20)
        assertEquals(listOf("episode-8", "episode-7"), two.history.map { it.ref.itemId })
        assertEquals(0.0, two.history.first().position)
    }
    @Test fun removedHistoryIsNotResurrectedByLatePositionsAndCapacityExcludesFavorites() {
        val row = record()
        val empty = MediaState.change(MediaCollection(listOf(row), listOf(row)), MediaMutation.REMOVE_HISTORY, row, 20)
        val sampled = MediaState.change(empty, MediaMutation.POSITION, row.copy(position = 150.5), 20)
        assertTrue(sampled.history.isEmpty())
        assertEquals(150.5, sampled.favorites.single().position)
        assertEquals(1, MediaState.change(sampled, MediaMutation.VISIT, row, 0).favorites.size)
    }
    @Test fun invalidMeasurementsAndReferencesCannotCorruptState() {
        val row = record()
        val next = MediaState.change(MediaCollection(listOf(row), emptyList()), MediaMutation.POSITION, row.copy(position = Double.NaN), 20)
        assertEquals(125.9, next.history.single().position)
        assertEquals(0.0, MediaState.resume(Double.POSITIVE_INFINITY))
        assertFailsWith<IllegalArgumentException> { MediaRef("", "x") }
        assertFailsWith<IllegalArgumentException> { MediaState.resume(20.0, 0.0) }
    }
}
