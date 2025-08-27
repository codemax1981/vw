// time.js - Enhanced with skybox integration

// --- CONFIGURATION ---
const DAY_DURATION_SECONDS = 600; // Real-world seconds for one full game day (10 minutes)
const SUN_DISTANCE = 200; // How far away the sun/moon are

// Light and Color Settings
const maxSunlight = 0.8;
const minSunlight = 0.0;
const maxAmbient = 0.6;
const minAmbient = 0.15; // A bit of light even at midnight

const daySkyColor = new THREE.Color(0x87CEEB);
const nightSkyColor = new THREE.Color(0x0a0a2a);
const dawnDuskColor = new THREE.Color(0xFF8C00); // Orange for sunrise/sunset

export class TimeManager {
    constructor(scene, renderer, directionalLight, ambientLight) {
        this.scene = scene;
        this.renderer = renderer;
        this.sunLight = directionalLight;
        this.ambientLight = ambientLight;
        this._currentTime = 0.25; // Start at sunrise (0.25)
        this.dayDuration = DAY_DURATION_SECONDS;
        this.sun = null;
        this.moon = null;
        this.skyboxManager = null; // Will be set by main.js
        this.createSunAndMoon();
    }

    createSunAndMoon() {
        // Enhanced sun with corona effect
        const sunGeometry = new THREE.SphereGeometry(15, 32, 32);
        const sunMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xFFFF00, 
            fog: false,
            transparent: true,
            opacity: 0.9
        });
        this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
        
        // Add sun corona
        const coronaGeometry = new THREE.SphereGeometry(25, 32, 32);
        const coronaMaterial = new THREE.MeshBasicMaterial({
            color: 0xFFDD44,
            transparent: true,
            opacity: 0.2,
            fog: false
        });
        const corona = new THREE.Mesh(coronaGeometry, coronaMaterial);
        this.sun.add(corona);
        
        this.scene.add(this.sun);

        // Enhanced moon with phases
        const moonGeometry = new THREE.SphereGeometry(10, 32, 32);
        const moonMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xE0E0E0,
            fog: false,
            emissive: 0x222222
        });
        this.moon = new THREE.Mesh(moonGeometry, moonMaterial);
        
        // Add moon glow
        const moonGlowGeometry = new THREE.SphereGeometry(15, 32, 32);
        const moonGlowMaterial = new THREE.MeshBasicMaterial({
            color: 0xCCCCFF,
            transparent: true,
            opacity: 0.1,
            fog: false
        });
        const moonGlow = new THREE.Mesh(moonGlowGeometry, moonGlowMaterial);
        this.moon.add(moonGlow);
        
        this.scene.add(this.moon);
    }

    setSkyboxManager(skyboxManager) {
        this.skyboxManager = skyboxManager;
    }

    /**
     * Updates the time, celestial body positions, lighting, and sky color.
     * @param {number} deltaTime Time since the last frame.
     * @param {THREE.Vector3} playerPosition The current position of the player camera.
     */
    update(deltaTime, playerPosition) {
        // 1. Advance time
        this._currentTime += deltaTime / this.dayDuration;
        this._currentTime %= 1.0; // Wrap time around (0 to 1)

        // 2. Calculate sun/moon positions
        // We offset by -PI/2 so that noon (0.5) is at the top of the sky
        const sunAngle = this._currentTime * Math.PI * 2 - Math.PI / 2;
        const moonAngle = sunAngle + Math.PI;

        // The sun's position relative to the world origin
        const sunOrbitalPosition = new THREE.Vector3(
            0,
            Math.sin(sunAngle) * SUN_DISTANCE,
            Math.cos(sunAngle) * SUN_DISTANCE
        );

        // The moon's position relative to the world origin
        const moonOrbitalPosition = new THREE.Vector3(
            0,
            Math.sin(moonAngle) * SUN_DISTANCE,
            Math.cos(moonAngle) * SUN_DISTANCE
        );

        // Make celestial bodies follow the player on XZ plane
        this.sun.position.copy(playerPosition).add(sunOrbitalPosition);
        this.moon.position.copy(playerPosition).add(moonOrbitalPosition);

        // The directional light should "come from" the sun's direction
        this.sunLight.position.copy(sunOrbitalPosition).normalize();

        // 3. Update lighting intensity based on sun's height
        // sunY is a value from -1 (midnight) to 1 (noon)
        const sunY = Math.sin(sunAngle);
        const daylightIntensity = Math.max(0, sunY); // 0 at horizon, 1 at noon

        // Smooth the transition for a nicer sunrise/sunset
        const smoothedIntensity = Math.pow(daylightIntensity, 0.5);

        this.sunLight.intensity = minSunlight + (maxSunlight - minSunlight) * smoothedIntensity;
        this.ambientLight.intensity = minAmbient + (maxAmbient - minAmbient) * smoothedIntensity;

        // 4. Update sky and fog color (only if no skybox manager is handling it)
        if (!this.skyboxManager) {
            const skyColor = new THREE.Color();
            const dawnDuskInfluence = Math.pow(1.0 - Math.abs(sunY), 3); // Strong influence only near horizon

            skyColor.copy(nightSkyColor).lerp(daySkyColor, smoothedIntensity);
            skyColor.lerp(dawnDuskColor, dawnDuskInfluence * 0.5); // Mix in some orange

            this.renderer.setClearColor(skyColor);
        }

        // 5. Update celestial body visibility
        this.sun.visible = sunY > -0.1; // Hide sun when well below horizon
        this.moon.visible = sunY < 0.1; // Show moon when sun is low/gone

        // Adjust sun and moon intensity
        if (this.sun.material) {
            this.sun.material.opacity = Math.max(0.1, smoothedIntensity);
        }
        if (this.moon.material) {
            this.moon.material.emissive.setScalar(0.1 * (1 - smoothedIntensity));
        }

        // 6. Update skybox if available
        if (this.skyboxManager) {
            this.skyboxManager.update(deltaTime, playerPosition);
        }
    }

    /**
     * Returns the current time as a formatted string (e.g., "08:30").
     * @returns {string}
     */
    getFormattedTime() {
        const totalMinutes = Math.floor(this._currentTime * 24 * 60);
        const hours = Math.floor(totalMinutes / 60) % 24;
        const minutes = totalMinutes % 60;
        const paddedHours = String(hours).padStart(2, '0');
        const paddedMinutes = String(minutes).padStart(2, '0');
        return `${paddedHours}:${paddedMinutes}`;
    }

    /**
     * Get the current fog color based on time of day
     * @returns {THREE.Color}
     */
    getFogColor() {
        const sunAngle = this._currentTime * Math.PI * 2 - Math.PI / 2;
        const sunY = Math.sin(sunAngle);
        const daylightIntensity = Math.max(0, sunY);
        const smoothedIntensity = Math.pow(daylightIntensity, 0.5);
        
        const fogColor = new THREE.Color();
        const dawnDuskInfluence = Math.pow(1.0 - Math.abs(sunY), 3);
        
        // Base fog color transition from night to day
        fogColor.copy(nightSkyColor).lerp(daySkyColor, smoothedIntensity);
        
        // Add dawn/dusk orange tint
        fogColor.lerp(dawnDuskColor, dawnDuskInfluence * 0.3);
        
        return fogColor;
    }

    /**
     * A value from 0 (darkest) to 1 (brightest) representing current light level.
     * @returns {number}
     */
    getLightLevel() {
        const sunAngle = this._currentTime * Math.PI * 2 - Math.PI / 2;
        const sunY = Math.sin(sunAngle);
        return minAmbient + (maxAmbient - minAmbient) * Math.pow(Math.max(0, sunY), 0.5);
    }

    /**
     * Get current sun position for skybox calculations
     * @returns {THREE.Vector3}
     */
    getSunPosition() {
        const sunAngle = this._currentTime * Math.PI * 2 - Math.PI / 2;
        return new THREE.Vector3(
            0,
            Math.sin(sunAngle) * SUN_DISTANCE,
            Math.cos(sunAngle) * SUN_DISTANCE
        );
    }

    /**
     * Get current sun intensity
     * @returns {number}
     */
    getSunIntensity() {
        const sunAngle = this._currentTime * Math.PI * 2 - Math.PI / 2;
        const sunY = Math.sin(sunAngle);
        const daylightIntensity = Math.max(0, sunY);
        return Math.pow(daylightIntensity, 0.5);
    }

}