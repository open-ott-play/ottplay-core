OTT2.define("playback-view", function () {
    "use strict";
    function create(context) {
        var view = context.view, media = context.media, t = context.t;
        function openEngines() {
            var snapshot = media.getState(), cap = media.capabilities(), settings = context.state().settings;
            var engines = cap.engines || [{ id: "auto", label: "Auto", available: true }, { id: "native", label: "Native HTML5", available: true }];
            var activeLabel = snapshot.backend || "native";
            engines.forEach(function (engine) { if (engine.id === snapshot.backend) activeLabel = engine.label; });
            var html = '<p id="engine-active-status" role="status">' + (snapshot.channel && snapshot.state !== "stopped" ? t("Сейчас: ", "Active: ") + view.escape(activeLabel) + ' · ' + view.escape(snapshot.format === "unknown" ? "Auto" : String(snapshot.format || "auto").toUpperCase()) : t("Нет активного потока", "No stream playing")) + '</p><div class="f2-toolbar">';
            engines.forEach(function (engine, index) {
                if (engine.available) html += view.btn("engine-" + index, "selectEngine", view.escape(engine.label) + (settings.playerEngine === engine.id ? " ✓" : ""), engine.id);
                else html += '<span class="f2-engine-unavailable">' + view.escape(engine.label) + ' · ' + t("недоступен", "unavailable") + '</span>';
            });
            html += '</div><p class="f2-help">' + t("Auto подбирает движок под устройство и поток. Для HLS на LG первым используется встроенный плеер, в Chrome — Hls.js. Ваш выбор сохраняется.", "Auto matches the device and stream. For HLS, LG tries native first; Chrome uses Hls.js. Your choice is saved.") + '</p><h3>' + t("Формат потока", "Stream format") + '</h3><div class="f2-toolbar">';
            [["auto", "Auto"], ["hls", "HLS"], ["dash", "DASH"], ["mpegts", "MPEG-TS"], ["flv", "FLV"], ["file", "MP4 / file"]].forEach(function (entry, index) {
                html += view.btn("format-" + index, "selectFormat", entry[1] + (settings.streamFormat === entry[0] ? " ✓" : ""), entry[0]);
            });
            html += '</div><p class="f2-help">' + t("Меняйте формат, только если Auto не распознаёт поток. Совместимость кодеков зависит от устройства.", "Change the format only if Auto cannot identify the stream. Codec support depends on the device.") + '</p>';
            if (snapshot.lastError && snapshot.lastError.code) html += '<p>' + t("Ошибка: ", "Error: ") + view.escape(snapshot.lastError.code) + '</p>';
            view.dialog(t("Движок воспроизведения", "Playback engine"), html);
        }
        function open() {
            var snapshot = media.getState(), cap = media.capabilities(), tracks = media.listTracks(), html = '<div class="f2-toolbar">';
            if (cap.seek) html += view.btn("seek-back", "seekOffset", "−30 s", "-30") + view.btn("seek-forward", "seekOffset", "+30 s", "30");
            html += view.btn("volume-down", "changeVolume", "− " + t("Громкость", "Volume"), "-0.1") + view.btn("volume-up", "changeVolume", "+ " + t("Громкость", "Volume"), "0.1") + view.btn("toggle-mute", "toggleMute", snapshot.muted ? t("Включить звук", "Unmute") : t("Без звука", "Mute"));
            if (cap.pip) html += view.btn("picture-in-picture", "togglePip", snapshot.pip ? t("Закрыть PiP", "Exit picture in picture") : t("Картинка в картинке", "Picture in picture"));
            html += view.btn("options-engine", "engines", t("Движок воспроизведения", "Playback engine")) + '</div>';
            if (cap.audioTracks) { html += '<h3>' + t("Звуковая дорожка", "Audio track") + '</h3>'; tracks.audio.forEach(function (track, index) { html += view.btn("audio-" + index, "audioTrack", view.escape(track.label || track.language || String(index + 1)) + (track.selected ? " ✓" : ""), track.id); }); }
            if (cap.subtitleTracks) {
                html += '<h3>' + t("Субтитры", "Subtitles") + '</h3>' + view.btn("subtitle-off", "subtitleTrack", t("Выключены", "Off") + (tracks.subtitlesOff ? " ✓" : ""), "off");
                tracks.subtitles.forEach(function (track, index) { html += view.btn("subtitle-" + index, "subtitleTrack", view.escape(track.label || track.language || String(index + 1)) + (track.selected ? " ✓" : ""), track.id); });
            }
            if (cap.aspect) {
                html += '<h3>' + t("Формат изображения", "Picture size") + '</h3>';
                [["auto", t("Исходный", "Original")], ["fill", t("Заполнить", "Fill")], ["16:9", "16:9"], ["4:3", "4:3"]].forEach(function (entry, index) { html += view.btn("aspect-" + index, "aspect", entry[1], entry[0]); });
            }
            if (cap.zoom) { html += '<h3>' + t("Масштаб", "Zoom") + '</h3>'; [1, 1.1, 1.25, 1.5].forEach(function (value, index) { html += view.btn("zoom-" + index, "zoom", Math.round(value * 100) + "%", String(value)); }); }
            view.dialog(t("Воспроизведение", "Playback options"), html);
        }
        function handle(name, value) {
            var success = true;
            if (name === "playbackOptions") open();
            else if (name === "engines") openEngines();
            else if (name === "selectEngine") { success = context.changeEngine(value); if (success) openEngines(); }
            else if (name === "selectFormat") { success = context.changeFormat(value); if (success) openEngines(); }
            else if (name === "audioTrack") { success = context.preferences.select("audio", value); if (success) open(); }
            else if (name === "subtitleTrack") { success = context.preferences.select("subtitle", value); if (success) open(); }
            else if (name === "aspect") success = context.preferences.picture("aspect", value);
            else if (name === "zoom") success = context.preferences.picture("zoom", value);
            else if (name === "seekOffset") success = media.seek(media.getState().position + Number(value));
            else if (name === "changeVolume") { context.persist(function (s) { s.settings.volume = Math.max(0, Math.min(1, s.settings.volume + Number(value))); }); media.volume(context.state().settings.volume); }
            else if (name === "toggleMute") { context.persist(function (s) { s.settings.muted = !s.settings.muted; }); media.mute(context.state().settings.muted); open(); }
            else if (name === "togglePip") {
                if (media.getState().pip) success = media.exitPip(); else success = media.enterPip();
                if (success) view.closeDialog();
            } else return false;
            if (!success) view.toast(t("Эта возможность сейчас недоступна.", "This option is currently unavailable."));
            return true;
        }
        return { handle: handle, open: open, openEngines: openEngines };
    }
    return { create: create };
});
