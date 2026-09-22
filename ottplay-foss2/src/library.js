OTT2.define("library", function () {
    "use strict";
    var core = OttPlayCore;
    function name(value) { return core.favoriteListName(value); }
    function channelReference(channel, sourceId) { return core.channelReference(channel, sourceId); }
    function restoreChannel(items, reference) { var index = core.restoreChannelIndex(items, reference); return index < 0 ? null : items[index]; }
    function decorate(items, overrides, includeHidden) { return core.libraryDecorate(items, overrides, !!includeHidden); }
    function renameList(state, oldName, newName) { core.favoriteListChange(state, "browser", "rename", oldName, newName); }
    function removeList(state, selected) { core.favoriteListChange(state, "browser", "delete", selected); }
    function moveFavorite(state, id, delta) { core.moveFavoriteSelection(state.favorites[state.activeFavorites], id, delta); }
    function edit(state, id, values) { state.channelOverrides[id] = core.libraryEdit(id, values); }
    function reminderId(channelId, start) { return core.libraryReminderId(channelId, start); }
    function toggleReminder(state, channel, programme) { state.reminders = core.libraryToggleReminder(state.reminders, channel, programme); }
    return { decorate: decorate, channelReference: channelReference, restoreChannel: restoreChannel, renameList: renameList, removeList: removeList, moveFavorite: moveFavorite, edit: edit, name: name, toggleReminder: toggleReminder, reminderId: reminderId };
});
