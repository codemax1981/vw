

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

    // Smooth transition function - creates natural easing curves
    smoothTransition(t, power = 2.0) {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        return Math.pow(t, power);
    }

    // Atmospheric scattering curve - mimics how light behaves in the atmosphere
    atmosphericCurve(sunHeight) {
        // sunHeight ranges from -1 to 1
        const normalized = (sunHeight + 1) * 0.5; // Convert to 0-1
        
        // Use a sigmoid-like curve for natural atmospheric scattering
        const t = Math.max(0, Math.min(1, normalized * 1.2 - 0.1));
        return t * t * (3 - 2 * t); // Smoothstep function
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
            uniform float atmosphericIntensity;
            
            // Enhanced color palette with more transition states
            const vec3 dayTopColor = vec3(0.3, 0.6, 1.0);
            const vec3 dayHorizonColor = vec3(0.7, 0.85, 1.0);
            
            // Multiple night color stages for smoother transition
            const vec3 duskTopColor = vec3(0.1, 0.2, 0.5);
            const vec3 duskHorizonColor = vec3(0.3, 0.3, 0.6);
            const vec3 nightTopColor = vec3(0.005, 0.01, 0.03);
            const vec3 nightHorizonColor = vec3(0.02, 0.02, 0.08);
            
            // Golden hour colors
            const vec3 sunsetTopColor = vec3(0.8, 0.4, 0.2);
            const vec3 sunsetHorizonColor = vec3(1.0, 0.6, 0.2);
            const vec3 sunriseTopColor = vec3(0.9, 0.6, 0.3);
            const vec3 sunriseHorizonColor = vec3(1.0, 0.8, 0.4);

            // Smooth interpolation function
            vec3 smoothMix(vec3 a, vec3 b, float t) {
                float smoothT = t * t * (3.0 - 2.0 * t);
                return mix(a, b, smoothT);
            }

            void main() {
                vec3 direction = normalize(vWorldPosition);
                float sunDot = dot(direction, vSunDirection);
                
                // Enhanced vertical gradient with atmospheric perspective
                float verticalGradient = max(0.0, direction.y);
                
                // Multi-stage day/night transition
                vec3 finalColor;
                
                if (daylightRatio > 0.8) {
                    // Full daylight
                    finalColor = smoothMix(dayHorizonColor, dayTopColor, pow(verticalGradient, 0.6));
                } else if (daylightRatio > 0.4) {
                    // Golden hour transition
                    float goldenFactor = (daylightRatio - 0.4) / 0.4;
                    vec3 dayColor = smoothMix(dayHorizonColor, dayTopColor, pow(verticalGradient, 0.6));
                    
                    vec3 goldenTop = mix(sunsetTopColor, sunriseTopColor, step(0.0, vSunDirection.z));
                    vec3 goldenHorizon = mix(sunsetHorizonColor, sunriseHorizonColor, step(0.0, vSunDirection.z));
                    vec3 goldenColor = smoothMix(goldenHorizon, goldenTop, pow(verticalGradient, 0.4));
                    
                    finalColor = smoothMix(goldenColor, dayColor, pow(goldenFactor, 0.7));
                } else if (daylightRatio > 0.1) {
                    // Twilight transition
                    float twilightFactor = (daylightRatio - 0.1) / 0.3;
                    
                    vec3 goldenTop = mix(sunsetTopColor, sunriseTopColor, step(0.0, vSunDirection.z));
                    vec3 goldenHorizon = mix(sunsetHorizonColor, sunriseHorizonColor, step(0.0, vSunDirection.z));
                    vec3 goldenColor = smoothMix(goldenHorizon, goldenTop, pow(verticalGradient, 0.4));
                    
                    vec3 duskColor = smoothMix(duskHorizonColor, duskTopColor, pow(verticalGradient, 0.5));
                    
                    finalColor = smoothMix(duskColor, goldenColor, pow(twilightFactor, 0.5));
                } else {
                    // Night to twilight
                    float nightFactor = daylightRatio / 0.1;
                    vec3 nightColor = smoothMix(nightHorizonColor, nightTopColor, pow(verticalGradient, 0.3));
                    vec3 duskColor = smoothMix(duskHorizonColor, duskTopColor, pow(verticalGradient, 0.5));
                    
                    finalColor = smoothMix(nightColor, duskColor, pow(nightFactor, 0.3));
                }
                
                // Enhanced sun with smooth visibility
                float sunDistance = distance(direction, vSunDirection);
                float sunSize = 0.04;
                float sunGlow = 1.0 - smoothstep(0.0, sunSize, sunDistance);
                float sunCore = 1.0 - smoothstep(0.0, sunSize * 0.2, sunDistance);
                
                vec3 sunColor = vec3(1.0, 1.0, 0.95);
                if (daylightRatio < 0.6) {
                    float sunsetInfluence = 1.0 - (daylightRatio / 0.6);
                    sunColor = mix(sunColor, vec3(1.0, 0.5, 0.2), sunsetInfluence);
                }
                
                float sunVisibility = smoothstep(-0.1, 0.05, vSunDirection.y);
                finalColor += sunGlow * sunColor * daylightRatio * sunVisibility * 0.3; // MODIFIED: Reduced glow intensity
                finalColor += sunCore * sunColor * 1.5 * daylightRatio * sunVisibility;
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        this.skyUniforms = {
            time: { value: 0 },
            sunPosition: { value: new THREE.Vector3(0, 100, 0) },
            daylightRatio: { value: 1.0 },
            atmosphericIntensity: { value: 1.0 } // Add this line
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

        // Get enhanced lighting information from time manager
        const sunAngle = this.timeManager._currentTime * Math.PI * 2 - Math.PI / 2;
        const sunY = Math.sin(sunAngle);

        // Use atmospheric curve for more natural lighting
        const rawIntensity = Math.max(0, sunY);
        const atmosphericIntensity = this.atmosphericCurve(sunY);
        const nightIntensity = 1.0 - atmosphericIntensity;

        const sunPosition = new THREE.Vector3(
            0,
            Math.sin(sunAngle) * 200,
            Math.cos(sunAngle) * 200
        );

        // Update sky dome with enhanced parameters
        if (this.skyUniforms) {
            this.skyUniforms.time.value += deltaTime * 1000;
            this.skyUniforms.sunPosition.value.copy(sunPosition);
            this.skyUniforms.daylightRatio.value = atmosphericIntensity;
            this.skyUniforms.atmosphericIntensity.value = Math.max(0.3, atmosphericIntensity);
        }

        // Update stars with smooth transition
        if (this.starUniforms) {
            this.starUniforms.time.value += deltaTime * 1000;
            this.starUniforms.nightIntensity.value = nightIntensity;
        }

        // Update clouds with enhanced lighting
        this.cloudUniforms.forEach((uniforms, index) => {
            uniforms.time.value += deltaTime;
            uniforms.lightIntensity.value = Math.max(0.05, atmosphericIntensity);
            uniforms.sunDirection.value.copy(sunPosition).normalize();
        });

        // Update atmosphere ring
        if (this.atmosphereRing) {
            this.atmosphereRing.material.uniforms.time.value += deltaTime * 1000;
            this.atmosphereRing.material.uniforms.sunIntensity.value = atmosphericIntensity; // Changed from smoothedIntensity
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