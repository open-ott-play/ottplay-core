# Synthetic browser media probe

`probe.mp4` is three seconds of a generated navy 160×90 image at 10 fps and a
440 Hz sine tone. It contains no recording, provider data or personal metadata.
The H.264 baseline / AAC fixture lets the provider UI journeys assert actual
playback on each selected browser without installing ffmpeg on every runner.
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
