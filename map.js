// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoibWF3MDM0IiwiYSI6ImNtN2N0cTV5aDBoMmEyaG9xdng1dzhnMTkifQ.S4x98xAolUADJrWNX323_A';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18 // Maximum allowed zoom
});

map.on('load', () => { 
    // Map sources and layers for bike routes
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });

    map.addLayer({
        id: 'boston-bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': '#32D400',  
            'line-width': 4,          
            'line-opacity': 0.6       
        }
    });

    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': '#32D400',  
            'line-width': 4,          
            'line-opacity': 0.6       
        }
    });

    // Load station data
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    d3.json(jsonurl).then(jsonData => {
        console.log('Loaded JSON Data:', jsonData);
        let stations = jsonData.data.stations;
        console.log('Stations Array:', stations);

        // Ensure there's an SVG in the Mapbox container
        const container = d3.select(map.getCanvasContainer());
        let svg = container.select('svg');

        if (svg.empty()) {
            svg = container.append('svg')
                .attr('width', '100%')
                .attr('height', '100%')
                .style('position', 'absolute')
                .style('top', '0')
                .style('left', '0');
        }

        function getCoords(station) {
            const point = map.project(new mapboxgl.LngLat(+station.lon, +station.lat));
            return { cx: point.x, cy: point.y };
        }

        // Append circles to the SVG for each station
        const circles = svg.selectAll('circle')
            .data(stations)
            .enter()
            .append('circle')
            .attr('fill', 'steelblue')
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .attr('opacity', 0.8);

        // Function to update circle positions when the map moves/zooms
        function updatePositions() {
            circles
                .attr('cx', d => getCoords(d).cx)
                .attr('cy', d => getCoords(d).cy);
        }

        updatePositions();
        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);

        // Load traffic data
        d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv').then(trips => {
            console.log("Loaded Traffic Data:", trips.slice(0, 10));

            let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

            // Compute departures and arrivals
            let departures = d3.rollup(trips, v => v.length, d => d.start_station_id);
            let arrivals = d3.rollup(trips, v => v.length, d => d.end_station_id);

            let departuresByMinute = Array.from({ length: 1440 }, () => []);
            let arrivalsByMinute = Array.from({ length: 1440 }, () => []); 

            for (let trip of trips) {
                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);

                let startedMinutes = minutesSinceMidnight(trip.started_at);
                departuresByMinute[startedMinutes].push(trip);

                let endedMinutes = minutesSinceMidnight(trip.ended_at);
                arrivalsByMinute[endedMinutes].push(trip);
            }

            // Add traffic data to stations
            stations.forEach(station => {
                let id = station.short_name;
                station.arrivals = arrivals.get(id) ?? 0;
                station.departures = departures.get(id) ?? 0;
                station.totalTraffic = station.arrivals + station.departures;
            });

            console.log("Processed Stations with Traffic:", stations);

            // Define scale for circle sizes
            let radiusScale = d3.scaleSqrt()
                .domain([0, d3.max(stations, d => d.totalTraffic)])
                .range([3, 25]);

            // Update circle sizes based on traffic data
            circles
                .attr('r', d => radiusScale(d.totalTraffic))
                .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic)) 
                .each(function(d) {
                    // Add <title> for browser tooltips
                    d3.select(this)
                        .append('title')
                        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
                });

            function minutesSinceMidnight(date) {
                return date.getHours() * 60 + date.getMinutes();
              }

            function filterByMinute(tripsByMinute, minute) {
                // Normalize both to the [0, 1439] range
                // % is the remainder operator: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Remainder
                let minMinute = (minute - 60 + 1440) % 1440;
                let maxMinute = (minute + 60) % 1440;
              
                if (minMinute > maxMinute) {
                  let beforeMidnight = tripsByMinute.slice(minMinute);
                  let afterMidnight = tripsByMinute.slice(0, maxMinute);
                  return beforeMidnight.concat(afterMidnight).flat();
                } else {
                  return tripsByMinute.slice(minMinute, maxMinute).flat();
                }
              }

            // Filter trips based on time
            function filterTripsByTime() {

                // Update arrivals and departures based on filtered trips
                filteredArrivals = d3.rollup(filterByMinute(arrivalsByMinute, timeFilter), v => v.length, d => d.start_station_id);
                filteredDepartures = d3.rollup(filterByMinute(departuresByMinute, timeFilter), v => v.length, d => d.end_station_id);

                // Update stations based on filtered data
                filteredStations = stations.map(station => {
                    let clonedStation = { ...station };  // Clone station to avoid mutation
                    clonedStation.arrivals = filteredArrivals.get(clonedStation.short_name) ?? 0;
                    clonedStation.departures = filteredDepartures.get(clonedStation.short_name) ?? 0;
                    clonedStation.totalTraffic = clonedStation.arrivals + clonedStation.departures;
                    return clonedStation;
                });

                if (timeFilter === -1) {
                    // Update scale for circle sizes
                    radiusScale.domain([0, d3.max(filteredStations, d => d.totalTraffic)])
                               .range([3, 25]);
                } else {
                    // Update scale for circle sizes
                    radiusScale.domain([0, d3.max(stations, d => d.totalTraffic)])
                               .range([3, 50]);
                }

                circles
                    .data(filteredStations)
                    .attr('r', d => radiusScale(d.totalTraffic))
                    .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic)) 
                    .each(function(d) {
                        d3.select(this)
                            .append('title')
                            .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
                    });
            }

            // Initialize time filter
            let timeFilter = -1;
            const timeSlider = document.getElementById('time-slider');
            const selectedTime = document.getElementById('selected-time');
            const anyTimeLabel = document.getElementById('any-time');

            function formatTime(minutes) {
                const date = new Date(0, 0, 0, 0, minutes);
                return date.toLocaleString('en-US', { timeStyle: 'short' });
            }

            function updateTimeDisplay() {
                timeFilter = Number(timeSlider.value);
                if (timeFilter === -1) {
                    selectedTime.textContent = '';
                    anyTimeLabel.style.display = 'block';
                } else {
                    selectedTime.textContent = formatTime(timeFilter);
                    anyTimeLabel.style.display = 'none';
                }
                filterTripsByTime();
            }

            timeSlider.addEventListener('input', updateTimeDisplay);
            updateTimeDisplay();

        }).catch(error => {
            console.error('Error loading CSV:', error);
        });

    }).catch(error => {
        console.error('Error loading JSON:', error);
    });
});