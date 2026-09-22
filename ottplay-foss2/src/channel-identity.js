/* Source-bound identity policy is shared; the host supplies its persisted URL fingerprint. */
OTT2.define("channel-identity", function () {
    "use strict";
    var core = OttPlayCore;
    function fingerprint(value) {
        var a = 2166136261, b = 5381, i;
        for (i = 0; i < value.length; i++) { a ^= value.charCodeAt(i); a += (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24); b = ((b << 5) + b) ^ value.charCodeAt(i); }
        return (a >>> 0).toString(16) + "-" + (b >>> 0).toString(16);
    }
    function descriptor(item, sourceId) { return core.channelDescriptor(item, sourceId, fingerprint); }
    function remember(state, items, sourceId) { state.channelReferences = core.rememberChannelIdentity(state, items, sourceId, fingerprint); }
    function reconcile(state, items, sourceId) {
        var result = core.reconcileChannelIdentity(state, items, sourceId, fingerprint);
        Object.keys(result.state).forEach(function (key) { state[key] = result.state[key]; });
        return result.report;
    }
    function permission(report, id, protectedIds) { return core.channelIdentityPermission(report, id, protectedIds); }
    return { remember: remember, reconcile: reconcile, permission: permission, descriptor: descriptor, limit: 50000 };
});
