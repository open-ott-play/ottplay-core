# Synthetic browser media probe

`probe.mp4` is three seconds of a generated navy 160×90 image at 10 fps and a
440 Hz sine tone. It contains no recording, provider data or personal metadata.
The original H.264 baseline / AAC fixture lets 32 extended-matrix targets assert
actual muxed-pipeline advancement without installing ffmpeg on every runner.
`probe-video-only.mp4` copies the identical encoded H.264 stream without AAC. Only
the three hosted Windows WebKit rows use it, selected before the journey, because
the runner has no audio endpoint. All 35 retain identical decoded-video assertions;
none asserts audible output. Windows WebKit AAC playback remains unverified.
`manifest.json` binds both byte sequences to their declared stream inventories;
`mediaCoverage` records that inventory and the actual selection in each report.
It does not replace the existing generated legacy-MSE/worker fixtures.

Regenerate with ffmpeg (the output bytes can vary with encoder versions):

```sh
ffmpeg -nostdin -y -hide_banner -loglevel error -threads 1 -filter_threads 1 \
  -f lavfi -i color=c=navy:s=160x90:r=10 \
  -f lavfi -i sine=frequency=440:sample_rate=44100 -t 3 \
  -c:v libx264 -threads 1 -profile:v baseline -level 3.0 -preset veryslow \
  -crf 30 -pix_fmt yuv420p -c:a aac -b:a 24k -map_metadata -1 \
  -fflags +bitexact -flags:v +bitexact -flags:a +bitexact -movflags +faststart probe.mp4
```

Create the video-only derivative without re-encoding the H.264 stream:

```sh
ffmpeg -nostdin -y -hide_banner -loglevel error -i probe.mp4 \
  -map 0:v:0 -c:v copy -an -map_metadata -1 -movflags +faststart probe-video-only.mp4
```

After regeneration, inspect both files with `ffprobe -show_streams`, compare the
extracted H.264 streams, and update the manifest hashes. A changed fixture fails
qualification until the source-bound inventory is updated and reviewed. Media
requests use an isolated loopback server; provider metadata remains synthetic.
