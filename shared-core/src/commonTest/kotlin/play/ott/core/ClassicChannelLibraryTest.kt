package play.ott.core

import kotlin.test.*

class ClassicChannelLibraryTest {
    private fun t(value: String) = ProviderValue.text(value)
    private fun n(value: Number) = ProviderValue(ProviderValueKind.NUMBER, value.toString())
    private fun b(value: Boolean) = ProviderValue(ProviderValueKind.BOOLEAN, value.toString())
    private fun a(vararg values: ProviderValue) = ProviderValue.array(values.toList())
    private fun ss(vararg values: String) = a(*values.map(::t).toTypedArray())
    private fun o(vararg values: Pair<String, ProviderValue>) = ProviderValue.obj(linkedMapOf(*values))
    private fun replace(value: ProviderValue, vararg changes: Pair<String, ProviderValue>) = ProviderValue.obj(LinkedHashMap(value.properties).apply { putAll(changes) })
    private fun g(id: String, label: String, vararg members: String) = o("id" to t(id), "label" to t(label), "members" to ss(*members))
    private fun providers() = listOf(g("system:all", "", "a", "b", "c"), g("p", "News", "a", "b"), g("q", "Sports", "c"))
    private fun state() = ClassicChannelLibrary.empty("source", listOf("a"))
    private fun request(action: String, vararg values: Pair<String, ProviderValue>) = o("version" to n(1), "action" to t(action), *values)
    private fun strings(value: ProviderValue) = value.elements.map { it.scalar }
    private fun find(value: ProviderValue, id: String) = value.elements.first { it["id"].scalar == id }
    // This test host supplies the JSON primitive coercion required by the API.
    private fun primitiveString(value: ProviderValue): String = if (value.kind == ProviderValueKind.NUMBER &&
        value.number().isFinite() && value.number() == kotlin.math.floor(value.number()) && kotlin.math.abs(value.number()) < 9e15)
        value.number().toLong().toString() else value.string()
    private fun decision(state: ProviderValue, request: ProviderValue, provider: List<ProviderValue> = providers()) =
        ClassicChannelLibrary.decision(state, provider, request, stringify = ::primitiveString)
    private fun reduce(state: ProviderValue, request: ProviderValue, provider: List<ProviderValue> = providers(), random: () -> Double = { 0.0 }) =
        ClassicChannelLibrary.reduce(state, provider, request, random = random, stringify = ::primitiveString)
    private fun dump(value: ProviderValue): String = when (value.kind) {
        ProviderValueKind.OBJECT -> value.properties.entries.joinToString(",", "{", "}") { it.key + ":" + dump(it.value) }
        ProviderValueKind.ARRAY -> value.elements.joinToString(",", "[", "]", transform = ::dump)
        else -> value.kind.toString() + ":" + value.scalar
    }

    @Test fun projectionFollowsProviderRefreshWithoutReaddingKnownRemovedMembers() {
        val inherited = replace(g("p", "", "old"), "inheritsMembers" to b(true))
        val edited = replace(g("q", "My sport", "c"), "known" to ss("c", "removed"))
        val before = replace(state(), "groups" to a(inherited, edited))
        val provider = listOf(g("system:all", "", "a", "d", "c", "removed", "new"), g("p", "Renamed", "a", "d"), g("q", "Sports", "c", "removed", "new"))
        val snapshot = dump(before)
        val rows = ClassicChannelLibrary.groups(before, provider)
        assertEquals("Renamed", find(rows, "p")["label"].scalar)
        assertEquals(listOf("a", "d"), strings(find(rows, "p")["members"]))
        assertEquals(listOf("c", "new"), strings(find(rows, "q")["members"]))
        assertEquals("My sport", find(rows, "q")["label"].scalar)
        assertEquals(snapshot, dump(before))
    }

    @Test fun hiddenAndMissingProviderGroupsKeepTheirClassicDisposition() {
        val before = replace(state(), "groups" to a(g("missing", "Saved", "unavailable")), "hidden" to ss("p"))
        val rows = ClassicChannelLibrary.groups(before, providers())
        assertEquals(listOf("missing", "system:all", "q"), rows.elements.map { it["id"].scalar })
        assertEquals(listOf("unavailable"), strings(rows.elements[0]["members"]))
        val next = reduce(before, request("remove", "groupId" to t("q")))
        assertEquals(listOf("p", "q"), strings(next["hidden"]))
        assertFalse(decision(before, request("remove", "groupId" to t("system:all"))).accepted)
    }

    @Test fun decoderRetainsV1ProfileAndRejectsForeignOrMalformedDocuments() {
        val input = replace(state(), "groups" to a(g("x", "X", "a", "a"), g("x", "duplicate", "b"), o("id" to n(3))),
            "hidden" to a(t("p"), t("p"), n(8)), "locks" to ss("a", "b"), "unlocks" to ss("a"),
            "preferences" to o("audio" to a(n(2), n(3)), "zoom" to o("a" to n(Double.NaN))),
            "selected" to o("groupId" to t("x"), "itemId" to t("a"), "future" to t("retained")))
        val decoded = ClassicChannelLibrary.decode(input, "source", listOf("a", "c"))!!
        assertEquals(1, decoded["groups"].elements.size)
        assertEquals(listOf("a"), strings(decoded["groups"].elements[0]["members"]))
        assertEquals(listOf("b", "c"), strings(decoded["locks"]))
        assertEquals(listOf("p"), strings(decoded["hidden"]))
        assertEquals(2.0, decoded["preferences"]["audio"]["0"].number())
        assertEquals(ProviderValueKind.MISSING, decoded["preferences"]["zoom"]["a"].kind)
        assertEquals("retained", decoded["selected"]["future"].scalar)
        assertNull(ClassicChannelLibrary.decode(input, "other-source", emptyList()))
        assertNull(ClassicChannelLibrary.decode(replace(input, "groups" to t("bad")), "source", emptyList()))
        assertNull(ClassicChannelLibrary.decode(replace(input, "version" to n(2)), "source", emptyList()))
    }

    @Test fun createRenameAndCopyKeepClassicIdentifiersAndDuplicateLabelPolicy() {
        val before = state()
        val create = request("create", "label" to t("  Custom  "), "copyId" to t("p"))
        assertEquals("user:1", decision(before, create).result.scalar)
        val next = reduce(before, create)
        assertEquals("Custom", next["groups"].elements[0]["label"].scalar)
        assertEquals(listOf("a", "b"), strings(next["groups"].elements[0]["members"]))
        assertEquals("user:2", decision(next, request("create", "label" to t("Second"))).result.scalar)
        assertFalse(decision(next, request("create", "label" to t("Custom"))).accepted)
        assertFalse(decision(next, request("rename", "groupId" to t("user:1"), "label" to t("News"))).accepted)
        val renamed = reduce(next, request("rename", "groupId" to t("user:1"), "label" to t(" Changed ")))
        assertEquals("Changed", renamed["groups"].elements[0]["label"].scalar)
        assertTrue(before["groups"].elements.isEmpty())
    }

    @Test fun memberEditsFreezeCurrentMembershipAndRememberProviderRefresh() {
        val remove = request("member", "groupId" to t("p"), "itemId" to t("a"), "memberAction" to t("remove"))
        val edited = reduce(state(), remove)
        val stored = find(edited["groups"], "p")
        assertEquals(listOf("b"), strings(stored["members"]))
        assertEquals(listOf("a", "b"), strings(stored["known"]))
        assertEquals("false", stored["inheritsMembers"].scalar)
        val refreshed = providers().map { if (it["id"].scalar == "p") g("p", "New label", "a", "b", "d") else it }
        assertEquals(listOf("b", "d"), strings(find(ClassicChannelLibrary.groups(edited, refreshed), "p")["members"]))
        val add = request("member", "groupId" to t("p"), "itemId" to t("a"), "memberAction" to t("add"))
        assertEquals(listOf("b", "a"), strings(find(reduce(edited, add)["groups"], "p")["members"]))
        // The old method still admits an unknown group and commits an unchanged model.
        val unknown = request("member", "groupId" to t("missing"), "itemId" to t("a"), "memberAction" to t("add"))
        assertTrue(decision(edited, unknown).commit)
        assertEquals(dump(edited), dump(reduce(edited, unknown)))
    }

    @Test fun memberAndGroupMoveUseTheOldWrapThenSplicePolicy() {
        val before = replace(state(), "groups" to a(g("user:1", "Custom", "a", "b", "c")), "nextGroup" to n(2))
        val moved = reduce(before, request("member", "groupId" to t("user:1"), "itemId" to t("a"), "memberAction" to t("move"), "delta" to n(-1)))
        assertEquals(listOf("b", "c", "a"), strings(find(moved["groups"], "user:1")["members"]))
        val order = reduce(before, request("move", "groupId" to t("q"), "delta" to n(1)))
        assertEquals(listOf("q", "user:1", "p"), order["groups"].elements.map { it["id"].scalar })
        assertFalse(decision(before, request("move", "groupId" to t("system:all"), "delta" to n(1))).accepted)
        assertFalse(decision(before, request("move", "groupId" to t("missing"), "delta" to n(1))).accepted)
    }

    @Test fun lockingAndProgressiveAppendPreserveExplicitUnlocks() {
        val unlocked = reduce(state(), request("lock", "itemId" to t("a"), "locked" to b(false)))
        assertTrue(unlocked["locks"].elements.isEmpty())
        assertEquals(listOf("a"), strings(unlocked["unlocks"]))
        assertEquals(listOf("b"), strings(ClassicChannelLibrary.addedLocks(unlocked["locks"], ss("a", "b", "b"), unlocked["unlocks"])))
        val locked = reduce(unlocked, request("lock", "itemId" to t("a"), "locked" to b(true)))
        assertEquals(listOf("a"), strings(locked["locks"]))
        assertTrue(locked["unlocks"].elements.isEmpty())
    }

    @Test fun selectionBrowseAndPreferencesRetainNoWriteAndDeletionCases() {
        val selected = reduce(state(), request("select", "groupId" to t("p"), "itemId" to t("b")))
        assertFalse(decision(selected, request("select", "groupId" to t("p"), "itemId" to t("b"))).commit)
        val browsed = reduce(selected, request("browse", "groupId" to t("p")))
        assertFalse(decision(browsed, request("browse", "groupId" to t("p"))).commit)
        assertTrue(decision(browsed, request("browse", "groupId" to t("p"), "durable" to b(true))).commit)
        assertTrue(decision(browsed, request("browse", "groupId" to t("system:favorites"))).accepted)
        assertFalse(decision(browsed, request("browse", "groupId" to t("missing"))).accepted)
        val preference = request("preference", "kind" to t("zoom"), "itemId" to t("b"), "value" to n(2))
        val saved = reduce(browsed, preference)
        assertEquals(2.0, saved["preferences"]["zoom"]["b"].number())
        val cleared = reduce(saved, request("preference", "kind" to t("zoom"), "itemId" to t("b"), "value" to ProviderValue.nil))
        assertEquals(ProviderValueKind.MISSING, cleared["preferences"]["zoom"]["b"].kind)
        assertFalse(decision(saved, request("preference", "kind" to t("unknown"), "itemId" to t("b"), "value" to n(2))).accepted)
    }

    @Test fun shuffleDrawsOnlyDuringReduceAndResetKeepsNewButNotRemovedMembers() {
        val provider = listOf(g("system:all", "", "a", "b", "c"), g("p", "News", "a", "b", "c"))
        val shuffle = request("shuffle", "groupId" to t("p")); var draws = 0
        assertTrue(decision(state(), shuffle, provider).accepted)
        assertEquals(0, draws)
        val shuffled = reduce(state(), shuffle, provider) { draws++; 0.0 }
        assertEquals(2, draws)
        assertEquals(listOf("b", "c", "a"), strings(find(shuffled["groups"], "p")["members"]))
        assertEquals(listOf("a", "b", "c"), strings(find(shuffled["groups"], "p")["shuffleBefore"]))
        val again = reduce(shuffled, shuffle, provider) { 0.5 }
        assertEquals(listOf("a", "b", "c"), strings(find(again["groups"], "p")["shuffleBefore"]))
        val changed = replace(shuffled, "groups" to a(replace(find(shuffled["groups"], "p"), "members" to ss("c", "b", "d"))))
        val restored = reduce(changed, request("resetShuffle", "groupId" to t("p")), provider)
        assertEquals(listOf("b", "c", "d"), strings(find(restored["groups"], "p")["members"]))
        assertEquals(ProviderValueKind.MISSING, find(restored["groups"], "p")["shuffleBefore"].kind)
        assertFailsWith<IllegalArgumentException> { reduce(state(), shuffle, provider) { 1.0 } }
    }

    @Test fun adoptOrderResetsOnlyProviderOverridesAndPreservesOtherState() {
        val custom = g("user:1", "Saved", "c")
        val edited = replace(g("p", "My name", "b"), "inheritsMembers" to b(false), "known" to ss("a", "b"), "shuffleBefore" to ss("a", "b"))
        val before = replace(state(), "groups" to a(edited, custom), "nextGroup" to n(2), "hidden" to ss("q"))
        assertFalse(decision(before, request("adoptOrder", "order" to ss("b", "a", "c"))).accepted)
        val next = reduce(before, request("adoptOrder", "order" to ss("a", "b", "c")))
        val group = find(next["groups"], "p")
        assertEquals("My name", group["label"].scalar)
        assertEquals("true", group["inheritsMembers"].scalar)
        assertTrue(group["members"].elements.isEmpty())
        assertEquals(ProviderValueKind.MISSING, group["known"].kind)
        assertEquals(dump(custom), dump(find(next["groups"], "user:1")))
        assertEquals("a", next["selected"]["itemId"].scalar)
        assertEquals(listOf("q"), strings(next["hidden"]))
        assertEquals(listOf("a"), strings(next["locks"]))
    }

    @Test fun malformedOrFutureStateCannotTurnIntoAnAuthorizedWrite() {
        val bad = replace(state(), "groups" to t("not a list")); val before = dump(bad)
        assertFalse(decision(bad, request("create", "label" to t("New"))).accepted)
        assertFailsWith<IllegalArgumentException> { reduce(bad, request("create", "label" to t("New"))) }
        assertEquals(before, dump(bad))
        assertFalse(decision(state(), replace(request("create", "label" to t("New")), "version" to n(2))).accepted)
        assertFalse(decision(state(), request("unknown")).accepted)
    }

    @Test fun primitiveFormattingStaysWithTheHostRatherThanKotlinFloatingSuffixes() {
        val input = replace(state(), "nextGroup" to n(1e21))
        val result = ClassicChannelLibrary.decision(input, providers(), request("create", "label" to t("Large counter")), stringify = { "1e+21" })
        assertEquals("user:1e+21", result.result.scalar)
    }

    @Test fun preferenceMapConversionDoesNotInventAnOwnPrototypeField() {
        val action = request("preference", "kind" to t("audio"), "itemId" to t("__proto__"), "value" to n(2))
        val next = reduce(state(), action)
        assertEquals(ProviderValueKind.MISSING, next["preferences"]["audio"]["__proto__"].kind)
        val own = replace(state(), "preferences" to o("audio" to o("__proto__" to n(1))))
        assertEquals(2.0, reduce(own, action)["preferences"]["audio"]["__proto__"].number())
    }
    @Test fun providerIndependentActionsSkipProjectionWithoutRelaxingValidation() {
        val independent = listOf(
            request("lock", "itemId" to t("a"), "locked" to b(false)),
            request("select", "groupId" to t("p"), "itemId" to t("b")),
            request("preference", "kind" to t("audio"), "itemId" to t("b"), "value" to n(2)),
            request("remove", "groupId" to t("q")))
        // Force resolution work if a projection is accidentally computed.
        val before = replace(state(), "groups" to a(g("user:1", "Custom", "a")))
        val forbiddenResolve: (String) -> String = { error("Unneeded group projection") }
        val malformedProvider = listOf(o("id" to t("bad")))
        for (action in independent) {
            assertFalse(ClassicChannelLibrary.needsProviderContext(action))
            val admitted = ClassicChannelLibrary.decision(before, providers(), action, forbiddenResolve, ::primitiveString)
            val withoutProvider = ClassicChannelLibrary.decision(before, emptyList(), action, forbiddenResolve, ::primitiveString)
            assertEquals(admitted.accepted, withoutProvider.accepted)
            assertEquals(admitted.commit, withoutProvider.commit)
            assertEquals(dump(admitted.result), dump(withoutProvider.result))
            val full = ClassicChannelLibrary.reduce(before, providers(), action, forbiddenResolve, stringify = ::primitiveString)
            val projected = ClassicChannelLibrary.reduce(before, emptyList(), action, forbiddenResolve, stringify = ::primitiveString)
            assertEquals(dump(full), dump(projected))
            assertFalse(decision(before, action, malformedProvider).accepted)
            assertFailsWith<IllegalArgumentException> { reduce(before, action, malformedProvider) }
        }
        for (action in listOf("member", "create", "move", "rename", "resetShuffle", "shuffle", "browse", "adoptOrder", "future"))
            assertTrue(ClassicChannelLibrary.needsProviderContext(request(action)))
        assertTrue(ClassicChannelLibrary.needsProviderContext(ProviderValue.nil))
        assertTrue(ClassicChannelLibrary.needsProviderContext(replace(request("lock"), "version" to n(2))))
    }

    @Test fun reductionSharesOneLazyProjectionWithAdmission() {
        val before = replace(state(), "groups" to a(g("user:1", "Custom", "a", "b")))
        var resolutions = 0
        val resolve: (String) -> String = { resolutions++; it }
        val next = ClassicChannelLibrary.reduce(before, providers(), request("shuffle", "groupId" to t("user:1")),
            resolve, random = { 0.0 }, stringify = ::primitiveString)
        assertEquals(listOf("b", "a"), strings(find(next["groups"], "user:1")["members"]))
        assertEquals(2, resolutions, "Only one projection of the two stored members is needed")
    }

    @Test fun indexedGroupsAndMoveKeepFirstMatchesDuplicatesAndResolutionOrder() {
        val first = replace(g("p", "", "old"), "inheritsMembers" to b(true), "known" to ss("a"))
        val second = replace(g("p", "Second", "b"), "known" to ss("a"))
        val before = replace(state(), "groups" to a(first, second, g("hidden", "Hidden", "h")), "hidden" to ss("hidden"))
        val provider = listOf(g("p", "First provider", "a"), g("p", "Later provider", "wrong"), g("q", "Q", "c"))
        val stateSnapshot = dump(before); val providerSnapshot = provider.map(::dump)
        val resolutions = mutableListOf<String>()
        val rows = ClassicChannelLibrary.groups(before, provider) { resolutions += it; it }
        assertEquals(listOf("p", "p", "q"), rows.elements.map { it["id"].scalar })
        assertEquals(listOf("First provider", "Second", "Q"), rows.elements.map { it["label"].scalar })
        assertEquals(listOf(listOf("a"), listOf("b"), listOf("c")), rows.elements.map { strings(it["members"]) })
        // Hidden stored members are resolved before filtering; appended provider members are not.
        assertEquals(listOf("a", "b", "h"), resolutions)
        val moved = reduce(before, request("move", "groupId" to t("q"), "delta" to n(1)), provider)["groups"].elements
        assertEquals(listOf("q", "p", "p"), moved.map { it["id"].scalar })
        assertEquals(listOf("", "", ""), moved.map { it["label"].scalar })
        assertEquals(listOf("true", "true", "true"), moved.map { it["inheritsMembers"].scalar })
        assertEquals(listOf(listOf("c"), listOf("a"), listOf("b")), moved.map { strings(it["members"]) })
        assertEquals(listOf("a"), strings(moved[2]["known"]), "Both duplicate rows use the first stored metadata")
        assertEquals(stateSnapshot, dump(before))
        assertEquals(providerSnapshot, provider.map(::dump))
    }

    @Test fun groupProjectionMoveAndAdoptionUseLinearIdLookups() {
        val size = 256
        var reads = 0
        fun counted(row: ProviderValue): ProviderValue {
            val properties = row.properties
            return ProviderValue.obj(object : Map<String, ProviderValue> by properties {
                override fun get(key: String): ProviderValue? {
                    if (key == "id") reads++
                    return properties[key]
                }
            })
        }
        val provider = (0 until size).map { counted(g("p:$it", "P$it", "item:$it")) }
        val stored = (0 until size).map { counted(replace(g("p:$it", "", "old:$it"), "inheritsMembers" to b(true))) }
        val before = replace(state(), "groups" to ProviderValue.array(stored))
        val projected = ClassicChannelLibrary.groups(before, provider)
        assertEquals(size, projected.elements.size)
        assertTrue(reads < size * 20, "Projection must not scan provider groups per stored group: $reads ID reads")
        reads = 0
        val moved = reduce(before, request("move", "groupId" to t("p:0"), "delta" to n(1)), provider)
        assertEquals(listOf("p:1", "p:0"), moved["groups"].elements.take(2).map { it["id"].scalar })
        assertTrue(reads < size * 20, "Move must not scan stored groups per visible group: $reads ID reads")
        reads = 0
        val adopted = reduce(before, request("adoptOrder", "order" to ss()), provider)
        assertTrue(adopted["groups"].elements.all { it["members"].elements.isEmpty() })
        assertTrue(reads < size * 20, "Adoption must not scan provider groups per stored group: $reads ID reads")
    }

    @Test fun resetShufflePreservesResolvedFirstOrderAndAppendsOnlyNewMembers() {
        val size = 2048
        val members = (0 until size).map { "item:$it" }
        val saved = members.reversed().map { "old:$it" } + listOf("old:item:0", "removed")
        val row = replace(g("user:1", "Custom"), "members" to ss(*members.toTypedArray(), "new"),
            "shuffleBefore" to ss(*saved.toTypedArray()))
        val before = replace(state(), "groups" to a(row)); val snapshot = dump(before)
        var resolutions = 0
        val restored = ClassicChannelLibrary.reduce(before, emptyList(), request("resetShuffle", "groupId" to t("user:1")),
            resolve = { resolutions++; it.removePrefix("old:") }, stringify = ::primitiveString)
        assertEquals(members.reversed() + "new", strings(restored["groups"].elements.single()["members"]))
        assertEquals(members.size + 1 + saved.size, resolutions)
        assertEquals(snapshot, dump(before))
    }

}
