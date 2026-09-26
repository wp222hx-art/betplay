#!/bin/bash
# 把受保护的剧集视频上传到 R2（MEDIA 桶，key = <series_id>/<clip>.mp4）；本地加 --local
cd "$(dirname "$0")/.." ; MODE=${1:---local}
up() { for f in media_src/$1/*.mp4; do c=$(basename $f); npx wrangler r2 object put "webapp-media/$2/$c" --file "$f" --content-type video/mp4 $MODE >/dev/null 2>&1 && echo "ok $2/$c" || echo "FAIL $2/$c"; done; }
up love love_corridor
up film dome_film
