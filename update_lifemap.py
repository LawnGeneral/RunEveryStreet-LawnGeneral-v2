import csv
import gzip
import io
import json
import math
import os
import urllib.parse
import urllib.request
from datetime import datetime

GRID_FILE = "strava_lifemap_grid_10m.csv.gz"
STATE_FILE = "lifemap_state.json"

CELL_M = 10
DENSIFY_M = 5
MAX_INTERPOLATION_GAP_M = 200

STRAVA_ACCESS_TOKEN = os.environ.get("STRAVA_ACCESS_TOKEN")

if not STRAVA_ACCESS_TOKEN:
    raise RuntimeError("STRAVA_ACCESS_TOKEN is missing")


def api_get(path, params=None):
    url = "https://www.strava.com/api/v3" + path

    if params:
        url += "?" + urllib.parse.urlencode(params)

    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {STRAVA_ACCESS_TOKEN}"
        }
    )

    with urllib.request.urlopen(request) as response:
        return json.load(response)


def js_round(value):
    # Match JavaScript Math.round().
    return math.floor(value + 0.5)


def get_cell_key(lat, lon):
    lat_step = CELL_M / 111320

    lat_i = js_round(lat / lat_step)
    representative_lat = lat_i * lat_step

    lon_step = (
        CELL_M /
        (
            111320 *
            max(
                0.2,
                math.cos(math.radians(representative_lat))
            )
        )
    )

    lon_i = js_round(lon / lon_step)

    return lat_i, lon_i


def distance_m(lat1, lon1, lat2, lon2):
    radius = 6371000

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)

    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(d_phi / 2) ** 2 +
        math.cos(phi1) *
        math.cos(phi2) *
        math.sin(d_lambda / 2) ** 2
    )

    return radius * 2 * math.atan2(
        math.sqrt(a),
        math.sqrt(1 - a)
    )


def load_grid():
    cells = set()

    with gzip.open(
        GRID_FILE,
        "rt",
        encoding="utf-8",
        newline=""
    ) as file:
        reader = csv.reader(file)

        next(reader, None)

        for row in reader:
            if len(row) != 2:
                continue

            cells.add((int(row[0]), int(row[1])))

    return cells


def save_grid(cells):
    text = io.StringIO(newline="")

    writer = csv.writer(
        text,
        lineterminator="\n"
    )

    writer.writerow(["lat_i", "lon_i"])

    for lat_i, lon_i in sorted(cells):
        writer.writerow([lat_i, lon_i])

    compressed = gzip.compress(
        text.getvalue().encode("utf-8"),
        compresslevel=9,
        mtime=0
    )

    with open(GRID_FILE, "wb") as file:
        file.write(compressed)


def load_state():
    with open(
        STATE_FILE,
        "r",
        encoding="utf-8"
    ) as file:
        return json.load(file)


def save_state(state):
    with open(
        STATE_FILE,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            state,
            file,
            indent=2
        )
        file.write("\n")


def iso_to_epoch(value):
    return int(
        datetime.fromisoformat(
            value.replace("Z", "+00:00")
        ).timestamp()
    )


def get_new_activities(after_epoch):
    activities = []
    page = 1

    while True:
        batch = api_get(
            "/athlete/activities",
            {
                "after": after_epoch,
                "page": page,
                "per_page": 100
            }
        )

        if not batch:
            break

        activities.extend(batch)

        if len(batch) < 100:
            break

        page += 1

    return activities


def is_outdoor_run(activity):
    sport_type = activity.get("sport_type")

    if sport_type in ("Run", "TrailRun"):
        return True

    if not sport_type and activity.get("type") == "Run":
        return True

    return False


def get_latlng_stream(activity_id):
    stream = api_get(
        f"/activities/{activity_id}/streams",
        {
            "keys": "latlng",
            "key_by_type": "true"
        }
    )

    if isinstance(stream, dict):
        latlng = stream.get("latlng")

        if latlng:
            return latlng.get("data", [])

    if isinstance(stream, list):
        for item in stream:
            if item.get("type") == "latlng":
                return item.get("data", [])

    return []


def add_track_to_grid(points, cells):
    previous = None

    for point in points:
        if not isinstance(point, list) or len(point) < 2:
            continue

        lat = float(point[0])
        lon = float(point[1])

        cells.add(get_cell_key(lat, lon))

        if previous is not None:
            prev_lat, prev_lon = previous

            gap = distance_m(
                prev_lat,
                prev_lon,
                lat,
                lon
            )

            if 0 < gap <= MAX_INTERPOLATION_GAP_M:
                steps = max(
                    1,
                    math.ceil(gap / DENSIFY_M)
                )

                for step in range(1, steps):
                    t = step / steps

                    interp_lat = (
                        prev_lat +
                        (lat - prev_lat) * t
                    )

                    interp_lon = (
                        prev_lon +
                        (lon - prev_lon) * t
                    )

                    cells.add(
                        get_cell_key(
                            interp_lat,
                            interp_lon
                        )
                    )

        previous = (lat, lon)


def main():
    state = load_state()

    after_epoch = int(
        state.get("after_epoch", 0)
    )

    cells = load_grid()
    original_cell_count = len(cells)

    print(
        f"Existing LifeMap cells: "
        f"{original_cell_count}"
    )

    activities = get_new_activities(
        after_epoch
    )

    print(
        f"Activities since checkpoint: "
        f"{len(activities)}"
    )

    runs = [
        activity
        for activity in activities
        if is_outdoor_run(activity)
    ]

    print(
        f"Outdoor runs found: {len(runs)}"
    )

    for activity in runs:
        activity_id = activity["id"]
        activity_name = activity.get(
            "name",
            "Unnamed Run"
        )

        points = get_latlng_stream(
            activity_id
        )

        print(
            f"{activity_name}: "
            f"{len(points)} GPS points"
        )

        if points:
            add_track_to_grid(
                points,
                cells
            )

    new_cell_count = (
        len(cells) -
        original_cell_count
    )

    print(
        f"New LifeMap cells added: "
        f"{new_cell_count}"
    )

    if new_cell_count > 0:
        save_grid(cells)

    latest_epoch = after_epoch

    for activity in activities:
        start_date = activity.get(
            "start_date"
        )

        if start_date:
            latest_epoch = max(
                latest_epoch,
                iso_to_epoch(start_date)
            )

    if latest_epoch > after_epoch:
        state["after_epoch"] = latest_epoch
        save_state(state)

        print(
            f"Checkpoint updated to: "
            f"{latest_epoch}"
        )
    else:
        print("Checkpoint unchanged.")

    print("LifeMap update complete.")


if __name__ == "__main__":
    main()
