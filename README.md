# GTFS Syntax Highlighting

Syntax highlighting for [GTFS](https://gtfs.org/documentation/schedule/reference/) transit feed files in VS Code.

## Features

- **Rainbow columns** - each column in a GTFS file gets its own colour, so wide files like `stops.txt` and `stop_times.txt` are easy to read.
- Works automatically on standard GTFS file names (`agency.txt`, `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`, `calendar_dates.txt`, `shapes.txt`, and the rest of the spec).
- Colours come from your current theme.

## Notes

- Very large files (e.g. a 200 MB `stop_times.txt`) may open with highlighting disabled - that's a VS Code limit for big files.
- Highlighting applies to files by name, so any file called e.g. `stops.txt` is treated as GTFS. To turn it off for a file, pick another language from the status bar.

## Roadmap

- Hover a code (e.g. `route_type` `3`) to see its meaning
- Jump from an ID (e.g. `stop_id` in `stop_times.txt`) to its row in the referenced file

Inspired by [Rainbow CSV](https://marketplace.visualstudio.com/items?itemName=mechatroner.rainbow-csv).
