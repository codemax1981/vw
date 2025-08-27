// skybox.js

export class SkyboxManager {
    constructor(scene, renderer, camera, timeManager) {
        this.scene = scene;
        this.renderer = renderer;
        this.camera = camera;
        this.timeManager = timeManager;

        // Skybox configuration
        this.skyboxRadius = 500;
        this.atmosphereHeight = 80;

        // Create skybox components
        this.skyDome = null;
        this.starField = null;
        this.cloudLayers = [];
        this.atmosphereRing = null;

        // Shader uniforms for dynamic updates
        this.skyUniforms = null;
        this.starUniforms = null;
        this.cloudUniforms = [];

        // Performance tracking
        this.lastUpdate = 0;
        this.updateInterval = 50; // Update every 50ms for smoother transitions

        this.init();
    }

    init() {
        this.createSkyDome();
        this.createStarField();
        this.createCloudLayers();
        this.createAtmosphereRing();
        console.log('Procedural Skybox System initialized');
    }

    createSkyDome() {
        const geometry = new THREE.SphereGeometry(this.skyboxRadius, 64, 32);

        const skyVertexShader = `
            varying vec3 vWorldPosition;
            varying vec3 vSunDirection;
            uniform vec3 sunPosition;

            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                vSunDirection = normalize(sunPosition);
            }
        `;

        const skyFragmentShader = `
            varying vec3 vWorldPosition;
            varying vec3 vSunDirection;
            uniform float time;
            uniform vec3 sunPosition;
            uniform float daylightRatio;
            
            // Enhanced sky color definitions for better contrast
            const vec3 dayTopColor = vec3(0.2, 0.5, 1.0);          // Deep blue sky
            const vec3 dayHorizonColor = vec3(0.6, 0.8, 1.0);      // Light blue horizon
            const vec3 nightTopColor = vec3(0.005, 0.005, 0.02);   // Very dark blue-black
            const vec3 nightHorizonColor = vec3(0.01, 0.01, 0.05); // Slightly lighter at horizon
            const vec3 sunsetColor = vec3(1.0, 0.4, 0.1);          // Deep orange sunset
            const vec3 sunriseColor = vec3(1.0, 0.7, 0.3);         // Golden sunrise

            void main() {
                vec3 direction = normalize(vWorldPosition);
                float sunDot = dot(direction, vSunDirection);
                
                // Calculate vertical gradient (0 = horizon, 1 = zenith)
                float verticalGradient = max(0.0, direction.y);
                
                // Enhanced day sky colors with better gradient
                vec3 dayColor = mix(dayHorizonColor, dayTopColor, pow(verticalGradient, 0.6));
                
                // Much darker night sky colors
                vec3 nightColor = mix(nightHorizonColor, nightTopColor, pow(verticalGradient, 0.4));
                
                // Enhanced sunset/sunrise effect
                float sunsetInfluence = 0.0;
                if (vSunDirection.y > -0.3 && vSunDirection.y < 0.3) {
                    float horizonFactor = 1.0 - abs(direction.y);
                    float sunProximity = max(0.0, sunDot);
                    sunsetInfluence = pow(horizonFactor, 1.5) * pow(sunProximity, 0.3) * 
                                    (1.0 - abs(vSunDirection.y) * 3.0);
                }
                
                // Choose sunset or sunrise color based on time
                vec3 goldenColor = mix(sunsetColor, sunriseColor, step(0.0, vSunDirection.z));
                
                // Smoother day/night transition with proper curve
                float transitionFactor = pow(daylightRatio, 0.8);
                vec3 finalColor = mix(nightColor, dayColor, transitionFactor);
                
                // Add sunset/sunrise coloring with better blending
                finalColor = mix(finalColor, goldenColor, sunsetInfluence * 0.6);
                
                // Enhanced sun disk
                float sunDistance = distance(direction, vSunDirection);
                float sunSize = 0.03;
                float sunGlow = 1.0 - smoothstep(0.0, sunSize, sunDistance);
                float sunCore = 1.0 - smoothstep(0.0, sunSize * 0.3, sunDistance);
                
                // Sun color changes based on time of day
                vec3 sunColor = mix(vec3(1.0, 0.9, 0.8), vec3(1.0, 1.0, 0.95), transitionFactor);
                if (sunsetInfluence > 0.1) {
                    sunColor = mix(sunColor, vec3(1.0, 0.6, 0.2), sunsetInfluence);
                }
                
                finalColor += sunGlow * sunColor * daylightRatio * 0.8;
                finalColor += sunCore * sunColor * daylightRatio * 1.2;
                
                // Ensure night sky is properly opaque
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        this.skyUniforms = {
            time: { value: 0 },
            sunPosition: { value: new THREE.Vector3(0, 100, 0) },
            daylightRatio: { value: 1.0 }
        };

        const skyMaterial = new THREE.ShaderMaterial({
            uniforms: this.skyUniforms,
            vertexShader: skyVertexShader,
            fragmentShader: skyFragmentShader,
            side: THREE.BackSide,
            fog: false,
            transparent: false,
            depthWrite: false
        });

        this.skyDome = new THREE.Mesh(geometry, skyMaterial);
        this.skyDome.renderOrder = -1000;
        this.scene.add(this.skyDome);
    }

    createStarField() {
        const starCount = 12000; // More stars for better night sky
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);

        // Generate stars with realistic distribution
        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            
            // Use spherical coordinates for even distribution
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(1 - 2 * Math.random());
            const radius = this.skyboxRadius * 0.98;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.cos(phi);
            positions[i3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

            // Enhanced star colors based on stellar classification
            const temp = Math.random();
            if (temp < 0.1) {
                // Red giants - rare but bright
                colors[i3] = 1.0;
                colors[i3 + 1] = 0.3 + Math.random() * 0.3;
                colors[i3 + 2] = 0.1 + Math.random() * 0.2;
                sizes[i] = 3 + Math.random() * 4;
            } else if (temp < 0.6) {
                // Sun-like stars - most common
                colors[i3] = 1.0;
                colors[i3 + 1] = 0.9 + Math.random() * 0.1;
                colors[i3 + 2] = 0.8 + Math.random() * 0.2;
                sizes[i] = 1 + Math.random() * 2;
            } else if (temp < 0.9) {
                // Blue-white stars
                colors[i3] = 0.8 + Math.random() * 0.2;
                colors[i3 + 1] = 0.9 + Math.random() * 0.1;
                colors[i3 + 2] = 1.0;
                sizes[i] = 1.5 + Math.random() * 2.5;
            } else {
                // Bright stars - very rare
                colors[i3] = 1.0;
                colors[i3 + 1] = 1.0;
                colors[i3 + 2] = 1.0;
                sizes[i] = 4 + Math.random() * 6;
            }
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const starVertexShader = `
            attribute float size;
            varying vec3 vColor;
            varying float vAlpha;
            varying float vSize;
            uniform float time;
            uniform float nightIntensity;

            void main() {
                vColor = color;
                vSize = size;
                
                // Stars become visible as night approaches with better curve
                vAlpha = pow(nightIntensity, 0.5);
                
                // Enhanced twinkling effect
                float twinkleSpeed = 0.003 + (size * 0.0005);
                float twinkle = sin(time * twinkleSpeed + position.x * 0.01 + position.z * 0.01) * 0.3 + 0.7;
                vAlpha *= twinkle;
                
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * nightIntensity * (400.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `;

        const starFragmentShader = `
            varying vec3 vColor;
            varying float vAlpha;
            varying float vSize;

            void main() {
                float r = distance(gl_PointCoord, vec2(0.5, 0.5));
                if (r > 0.5) discard;
                
                // Better star shape with core and glow
                float core = 1.0 - smoothstep(0.0, 0.1, r);
                float glow = 1.0 - smoothstep(0.1, 0.5, r);
                
                float intensity = core + glow * 0.3;
                float alpha = intensity * vAlpha;
                
                gl_FragColor = vec4(vColor * intensity, alpha);
            }
        `;

        this.starUniforms = {
            time: { value: 0 },
            nightIntensity: { value: 0 }
        };

        const starMaterial = new THREE.ShaderMaterial({
            uniforms: this.starUniforms,
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true,
            fog: false
        });

        this.starField = new THREE.Points(geometry, starMaterial);
        this.starField.renderOrder = -999; // In front of sky dome but behind clouds
        this.scene.add(this.starField);
    }

    createCloudLayers() {
        // Create multiple cloud layers at different heights
        const cloudLayers = [
            { height: 120, density: 0.3, speed: 0.15, scale: 1.2 },
            { height: 90, density: 0.4, speed: 0.12, scale: 0.8 },
            { height: 70, density: 0.25, speed: 0.08, scale: 1.5 }
        ];

        cloudLayers.forEach((layerConfig, index) => {
            const cloudGeometry = new THREE.PlaneGeometry(this.skyboxRadius * 2.5, this.skyboxRadius * 2.5, 128, 128);

            const cloudVertexShader = `
                varying vec2 vUv;
                varying vec3 vWorldPosition;
                uniform float time;

                void main() {
                    vUv = uv;
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `;

            const cloudFragmentShader = `
                varying vec2 vUv;
                varying vec3 vWorldPosition;
                uniform float time;
                uniform float density;
                uniform float speed;
                uniform float scale;
                uniform float lightIntensity;
                uniform vec3 sunDirection;

                // Improved noise functions for better cloud shapes
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }

                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    
                    float a = hash(i);
                    float b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0));
                    float d = hash(i + vec2(1.0, 1.0));
                    
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    
                    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
                }

                float fbm(vec2 p) {
                    float value = 0.0;
                    float amplitude = 0.5;
                    float frequency = 1.0;
                    
                    for (int i = 0; i < 5; i++) {
                        value += amplitude * noise(p * frequency);
                        frequency *= 2.0;
                        amplitude *= 0.5;
                    }
                    
                    return value;
                }

                void main() {
                    vec2 st = vUv * scale;
                    st += vec2(time * speed * 0.02, time * speed * 0.01);
                    
                    // Enhanced cloud pattern
                    float cloudPattern = fbm(st * 2.0);
                    cloudPattern += fbm(st * 4.0) * 0.5;
                    cloudPattern += fbm(st * 8.0) * 0.25;
                    
                    float alpha = smoothstep(0.45, 0.75, cloudPattern) * density;
                    
                    // Enhanced lighting with better day/night distinction
                    vec3 normal = vec3(0.0, 1.0, 0.0);
                    float lightDot = max(0.1, dot(normal, sunDirection));
                    
                    // Day clouds - bright white/gray
                    vec3 dayCloudColor = mix(vec3(0.6, 0.6, 0.7), vec3(1.0, 1.0, 1.0), lightDot);
                    
                    // Night clouds - very dark
                    vec3 nightCloudColor = vec3(0.1, 0.1, 0.15) * lightDot;
                    
                    vec3 cloudColor = mix(nightCloudColor, dayCloudColor, lightIntensity);
                    
                    // Add sunset/sunrise coloring
                    if (lightIntensity < 0.6 && lightIntensity > 0.1) {
                        vec3 sunsetTint = vec3(1.0, 0.6, 0.3);
                        float sunsetFactor = (0.6 - lightIntensity) * 2.0;
                        cloudColor = mix(cloudColor, sunsetTint, sunsetFactor * 0.4);
                    }
                    
                    // Reduce cloud visibility at night
                    alpha *= (0.3 + lightIntensity * 0.7);
                    
                    gl_FragColor = vec4(cloudColor, alpha);
                }
            `;

            const cloudUniforms = {
                time: { value: 0 },
                density: { value: layerConfig.density },
                speed: { value: layerConfig.speed },
                scale: { value: layerConfig.scale },
                lightIntensity: { value: 1.0 },
                sunDirection: { value: new THREE.Vector3(0, 1, 0) }
            };

            const cloudMaterial = new THREE.ShaderMaterial({
                uniforms: cloudUniforms,
                vertexShader: cloudVertexShader,
                fragmentShader: cloudFragmentShader,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
                fog: false
            });

            const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
            cloudMesh.position.y = layerConfig.height;
            cloudMesh.rotation.x = -Math.PI / 2;
            cloudMesh.renderOrder = -900 + index;

            this.cloudLayers.push(cloudMesh);
            this.cloudUniforms.push(cloudUniforms);
            this.scene.add(cloudMesh);
        });
    }

    createAtmosphereRing() {
        // Create atmospheric glow around the horizon
        const atmosphereGeometry = new THREE.RingGeometry(this.skyboxRadius * 0.85, this.skyboxRadius * 1.15, 64);

        const atmosphereVertexShader = `
            varying vec2 vUv;
            varying vec3 vPosition;

            void main() {
                vUv = uv;
                vPosition = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const atmosphereFragmentShader = `
            varying vec2 vUv;
            varying vec3 vPosition;
            uniform float time;
            uniform float sunIntensity;
            uniform vec3 sunDirection;

            void main() {
                float distance = length(vPosition);
                float normalizedDistance = (distance - 425.0) / 150.0;
                float alpha = (1.0 - normalizedDistance) * 0.2;
                alpha = pow(max(0.0, alpha), 1.5);
                
                vec3 color = mix(
                    vec3(0.2, 0.4, 0.8), 
                    vec3(1.0, 0.7, 0.4), 
                    sunIntensity
                );
                
                gl_FragColor = vec4(color, alpha * sunIntensity);
            }
        `;

        const atmosphereUniforms = {
            time: { value: 0 },
            sunIntensity: { value: 1.0 },
            sunDirection: { value: new THREE.Vector3(0, 1, 0) }
        };

        const atmosphereMaterial = new THREE.ShaderMaterial({
            uniforms: atmosphereUniforms,
            vertexShader: atmosphereVertexShader,
            fragmentShader: atmosphereFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false
        });

        this.atmosphereRing = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        this.atmosphereRing.rotation.x = -Math.PI / 2;
        this.atmosphereRing.position.y = this.atmosphereHeight;
        this.atmosphereRing.renderOrder = -950;
        this.scene.add(this.atmosphereRing);
    }

    update(deltaTime, playerPosition) {
        const now = performance.now();
        if (now - this.lastUpdate < this.updateInterval) return;
        this.lastUpdate = now;

        // Update skybox position to follow player
        if (this.skyDome) {
            this.skyDome.position.copy(playerPosition);
        }

        if (this.starField) {
            this.starField.position.copy(playerPosition);
        }

        this.cloudLayers.forEach(cloud => {
            cloud.position.x = playerPosition.x;
            cloud.position.z = playerPosition.z;
        });

        if (this.atmosphereRing) {
            this.atmosphereRing.position.x = playerPosition.x;
            this.atmosphereRing.position.z = playerPosition.z;
        }

        // Get proper sun information from time manager
        const sunAngle = this.timeManager._currentTime * Math.PI * 2 - Math.PI / 2;
        const sunY = Math.sin(sunAngle);
        
        // Better daylight calculation that matches the TimeManager
        const rawIntensity = Math.max(0, sunY);
        const smoothedIntensity = Math.pow(rawIntensity, 0.5);
        const nightIntensity = Math.max(0, 1.0 - smoothedIntensity * 1.2); // Stars appear earlier

        const sunPosition = new THREE.Vector3(
            0,
            Math.sin(sunAngle) * 200,
            Math.cos(sunAngle) * 200
        );

        // Update sky dome with proper daylight ratio
        if (this.skyUniforms) {
            this.skyUniforms.time.value += deltaTime * 1000; // Convert to milliseconds
            this.skyUniforms.sunPosition.value.copy(sunPosition);
            this.skyUniforms.daylightRatio.value = smoothedIntensity;
        }

        // Update stars - they should be bright at night
        if (this.starUniforms) {
            this.starUniforms.time.value += deltaTime * 1000;
            this.starUniforms.nightIntensity.value = nightIntensity;
        }

        // Update clouds with better lighting
        this.cloudUniforms.forEach((uniforms, index) => {
            uniforms.time.value += deltaTime;
            uniforms.lightIntensity.value = Math.max(0.05, smoothedIntensity);
            uniforms.sunDirection.value.copy(sunPosition).normalize();
        });

        // Update atmosphere ring
        if (this.atmosphereRing) {
            this.atmosphereRing.material.uniforms.time.value += deltaTime * 1000;
            this.atmosphereRing.material.uniforms.sunIntensity.value = smoothedIntensity;
            this.atmosphereRing.material.uniforms.sunDirection.value.copy(sunPosition).normalize();
        }
    }

    // Method to adjust cloud density for weather effects
    setCloudDensity(density) {
        this.cloudUniforms.forEach(uniforms => {
            uniforms.density.value = density;
        });
    }

    // Method to adjust atmospheric conditions
    setAtmosphericConditions(rayleigh, turbidity, mieCoefficient) {
        console.log('Atmospheric conditions adjusted');
    }

    cleanup() {
        // Dispose of geometries and materials
        if (this.skyDome) {
            this.skyDome.geometry.dispose();
            this.skyDome.material.dispose();
            this.scene.remove(this.skyDome);
        }

        if (this.starField) {
            this.starField.geometry.dispose();
            this.starField.material.dispose();
            this.scene.remove(this.starField);
        }

        this.cloudLayers.forEach(cloud => {
            cloud.geometry.dispose();
            cloud.material.dispose();
            this.scene.remove(cloud);
        });

        if (this.atmosphereRing) {
            this.atmosphereRing.geometry.dispose();
            this.atmosphereRing.material.dispose();
            this.scene.remove(this.atmosphereRing);
        }

        console.log('Skybox system cleaned up');
    }
}