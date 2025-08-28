// main.js

import { World } from './world.js';
import { Player } from './player.js';
import { ChunkMesher } from './mesher.js';
import { MobManager } from './mobs.js';
import { AudioManager } from './audio.js';
import { TimeManager } from './time.js';
import { SkyboxManager } from './skybox.js';
import { worldToChunkCoords, BlockTypes, CHUNK_HEIGHT, WATER_LEVEL } from './utils.js';


class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);
        this.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true });

        this.audioManager = new AudioManager(this.camera);
        this.worldWorker = new Worker('./world-worker.js');
        this.workerReady = false;
        this.setupWorker();

        this.world = new World(this.worldWorker);
        this.player = new Player(this.camera, this.world);
        this.mesher = new ChunkMesher();
        this.mobManager = new MobManager(this.scene, this.world);
        
        this.timeManager = null;
        this.skyboxManager = null;
        this.ambientLight = null;
        this.directionalLight = null;

        this.hud = {
            fps: document.getElementById('fps'),
            position: document.getElementById('position'),
            chunkInfo: document.getElementById('chunkInfo'),
            time: document.getElementById('time'),
        };

        this.loadingScreen = document.getElementById('loading');
        this.loadingProgress = document.getElementById('loadingProgress');
        this.loadingProgressBar = document.getElementById('progressBar');

        this.clock = new THREE.Clock();
        this.lastChunkUpdate = 0;
        this.lastHUDUpdate = 0;

        this.devMenu = document.getElementById('devMenu');
        this.fogRange = document.getElementById('fogRange');
        this.fogValue = document.getElementById('fogValue');
        this.closeDevMenuBtn = document.getElementById('closeDevMenu');
        this.toggleFlyBtn = document.getElementById('toggleFlyMode');
        this.renderDistanceSlider = document.getElementById('renderDistance');
        this.renderValue = document.getElementById('renderValue');
        this._devMenuOpen = false;

        this.inventoryUI = document.getElementById('inventoryUI');
        this.blockSelector = document.getElementById('blockSelector');
        this.selectedItemDisplay = document.getElementById('selectedBlockDisplay');
        this._inventoryOpen = false;
        this.selectedBlockType = BlockTypes.DIRT;
        
        this.blockNames = {
            [BlockTypes.DIRT]: 'Dirt', [BlockTypes.GRASS]: 'Grass', [BlockTypes.SAND]: 'Sand',
            [BlockTypes.LOG]: 'Log', [BlockTypes.LEAVES]: 'Leaves', [BlockTypes.WATER]: 'Water',
            [BlockTypes.STONE]: 'Stone', [BlockTypes.GRAVEL]: 'Gravel', [BlockTypes.COAL_ORE]: 'Coal Ore',
            [BlockTypes.BEDROCK]: 'Bedrock'
        };
        
        this.blockColors = {
            [BlockTypes.DIRT]: '#8B4513', [BlockTypes.GRASS]: '#228B22', [BlockTypes.SAND]: '#F4A460',
            [BlockTypes.LOG]: '#654321', [BlockTypes.LEAVES]: '#32CD32', [BlockTypes.WATER]: '#4169E1',
            [BlockTypes.STONE]: '#808080', [BlockTypes.GRAVEL]: '#999999', [BlockTypes.COAL_ORE]: '#2F2F2F',
            [BlockTypes.BEDROCK]: '#1A1A1A'
        };

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.maxReach = 5;

        this.setupMouseEvents();
        this.setupInventory();
        
        console.log('Game initialized');
    }

    setupWorker() {
        this.worldWorker.onmessage = (e) => {
            const { cmd } = e.data;
            if (cmd === 'ready') {
                this.workerReady = true;
                console.log('World worker ready');
            } else if (cmd === 'chunk') {
                this.world.onWorkerMessage(e.data);
            } else if (cmd === 'mesh') {
                const { chunkX, chunkZ, opaqueData, transparentData } = e.data;
                const chunk = this.world.getChunk(chunkX, chunkZ);
                if (chunk) {
                    // --- MODIFIED: ATOMIC SWAP LOGIC ---
                    // 1. Remove the old mesh if it exists
                    if (chunk.mesh) {
                        this.scene.remove(chunk.mesh);
                        chunk.mesh.traverse(child => {
                            if (child.geometry) child.geometry.dispose();
                        });
                    }
                    
                    // 2. Create the new mesh from the worker's data
                    const newMesh = this.mesher.createMeshFromData(opaqueData, transparentData, chunkX, chunkZ);
                    
                    // 3. Add the new mesh to the scene and update the chunk object
                    if (newMesh) {
                        chunk.mesh = newMesh;
                        this.scene.add(newMesh);
                    } else {
                        chunk.mesh = null; // Ensure mesh is null if no geometry was created
                    }
                    
                    chunk.isMeshing = false;
                }
            }
        };

        this.worldWorker.postMessage({
            cmd: 'init',
            data: { seed: Math.random() }
        });
    }
    
    setupMouseEvents() {
        document.addEventListener('click', () => {
            this.audioManager.unlockAudio();
            if (document.pointerLockElement !== document.body && !this._devMenuOpen && !this._inventoryOpen) {
                document.body.requestPointerLock();
            }
        });

        document.addEventListener('mousedown', (e) => {
            if (document.pointerLockElement !== document.body || this._devMenuOpen || this._inventoryOpen) return;
            e.preventDefault();
            if (e.button === 0) this.breakBlock();
            else if (e.button === 2) this.placeBlock();
        });

        document.addEventListener('contextmenu', (e) => {
            if (document.pointerLockElement === document.body) e.preventDefault();
        });
    }

    breakBlock() {
        const tgt = this.getTargetBlock();
        if (!tgt || tgt.type === BlockTypes.WATER || tgt.type === BlockTypes.BEDROCK) return;
        
        this.audioManager.playSound('break', 0.6);
        this.world.setBlock(tgt.x, tgt.y, tgt.z, BlockTypes.AIR);
        
        // IMMEDIATE VISUAL FEEDBACK - Remove any temporary blocks at this position
        const existingTemp = this.scene.children.find(child => 
            child.userData.isTemporary && 
            child.userData.blockPosition.x === tgt.x &&
            child.userData.blockPosition.y === tgt.y &&
            child.userData.blockPosition.z === tgt.z
        );
        if (existingTemp) {
            this.scene.remove(existingTemp);
            existingTemp.geometry.dispose();
            existingTemp.material.dispose();
        }
        
        this.markChunkForRemesh(tgt.x, tgt.y, tgt.z);
    }
      
    setupInventory() {
        if (!this.blockSelector) return;
        const blockItems = this.blockSelector.querySelectorAll('.block-item');
        blockItems.forEach(item => {
            item.addEventListener('click', () => {
                const blockType = parseInt(item.dataset.block);
                this.selectBlock(blockType);
            });
        });
        this.selectBlock(BlockTypes.DIRT);
    }

    selectBlock(blockType) {
        this.selectedBlockType = blockType;
        if (this.blockSelector) {
            const blockItems = this.blockSelector.querySelectorAll('.block-item');
            blockItems.forEach(item => {
                item.classList.toggle('selected', parseInt(item.dataset.block) === blockType);
            });
        }
        if (this.selectedItemDisplay) {
            this.selectedItemDisplay.style.backgroundColor = this.blockColors[blockType];
            this.selectedItemDisplay.textContent = this.blockNames[blockType];
        }
    }
    
    getTargetBlock() {
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        const origin = this.camera.position.clone();
        const step = 0.1;
        const maxSteps = Math.ceil(this.maxReach / step);

        for (let i = 1; i <= maxSteps; i++) {
            const distance = i * step;
            const pos = origin.clone().add(direction.clone().multiplyScalar(distance));
            const blockX = Math.floor(pos.x);
            const blockY = Math.floor(pos.y);
            const blockZ = Math.floor(pos.z);
            const blockType = this.world.getBlock(blockX, blockY, blockZ);

            if (blockType !== BlockTypes.AIR && blockType !== BlockTypes.WATER) {
                return { x: blockX, y: blockY, z: blockZ, type: blockType };
            }
        }
        return null;
    }

    getPlacePosition() {
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        const origin = this.camera.position.clone();
        const step = 0.2;
        let lastAirPos = null;

        for (let distance = step; distance < this.maxReach; distance += step) {
            const pos = origin.clone().add(direction.clone().multiplyScalar(distance));
            const blockX = Math.floor(pos.x);
            const blockY = Math.floor(pos.y);
            const blockZ = Math.floor(pos.z);
            const blockType = this.world.getBlock(blockX, blockY, blockZ);

            if (blockType === BlockTypes.AIR) {
                lastAirPos = { x: blockX, y: blockY, z: blockZ };
            } else {
                return lastAirPos;
            }
        }
        return null;
    }

    createTemporaryBlockMesh(x, y, z, blockType) {
        if (blockType === BlockTypes.AIR) return null;
        
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({
            color: this.blockColors[blockType],
            transparent: blockType === BlockTypes.WATER,
            opacity: blockType === BlockTypes.WATER ? 0.7 : 1.0
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.isTemporary = true;
        mesh.userData.blockPosition = { x, y, z };
        
        return mesh;
    }
        
    placeBlock() {
        const placePos = this.getPlacePosition();
        if (!placePos) return;
        if (this.world.getBlock(placePos.x, placePos.y, placePos.z) !== BlockTypes.AIR) return;
    
        const playerPos = this.player.position;
        const playerBlockX = Math.floor(playerPos.x);
        const playerBlockY = Math.floor(playerPos.y);
        const playerBlockZ = Math.floor(playerPos.z);
        const playerHeadY = Math.floor(playerPos.y + this.player.height);
    
        if (placePos.x === playerBlockX && placePos.z === playerBlockZ &&
            (placePos.y === playerBlockY || placePos.y === playerHeadY)) {
            return;
        }
    
        this.audioManager.playSound('place', 0.8);
        this.world.setBlock(placePos.x, placePos.y, placePos.z, this.selectedBlockType);
        
        // IMMEDIATE VISUAL FEEDBACK - Add temporary block
        const tempMesh = this.createTemporaryBlockMesh(placePos.x, placePos.y, placePos.z, this.selectedBlockType);
        if (tempMesh) {
            this.scene.add(tempMesh);
        }
        
        this.markChunkForRemesh(placePos.x, placePos.y, placePos.z);
    }

    cleanupTemporaryBlocks(chunkX, chunkZ) {
        const chunkWorldX = chunkX * 16;
        const chunkWorldZ = chunkZ * 16;
        
        // Remove temporary blocks within this chunk's bounds
        const tempBlocks = this.scene.children.filter(child => 
            child.userData.isTemporary &&
            child.userData.blockPosition.x >= chunkWorldX &&
            child.userData.blockPosition.x < chunkWorldX + 16 &&
            child.userData.blockPosition.z >= chunkWorldZ &&
            child.userData.blockPosition.z < chunkWorldZ + 16
        );
        
        tempBlocks.forEach(tempBlock => {
            this.scene.remove(tempBlock);
            tempBlock.geometry.dispose();
            tempBlock.material.dispose();
        });
    }

    markChunkForRemesh(worldX, worldY, worldZ) {
        const { x: chunkX, z: chunkZ } = worldToChunkCoords(worldX, worldZ);
        this.remeshChunk(chunkX, chunkZ);

        const localX = Math.floor(worldX) - chunkX * 16;
        const localZ = Math.floor(worldZ) - chunkZ * 16;
        
        if (localX === 0) this.remeshChunk(chunkX - 1, chunkZ);
        if (localX === 15) this.remeshChunk(chunkX + 1, chunkZ);
        if (localZ === 0) this.remeshChunk(chunkX, chunkZ - 1);
        if (localZ === 15) this.remeshChunk(chunkX, chunkZ + 1);
    }

    // --- MODIFIED: This function now only flags the chunk for an update ---
    remeshChunk(chunkX, chunkZ) {
        const chunk = this.world.getChunk(chunkX, chunkZ);
        if (chunk) {
            chunk.needsRemesh = true;
        }
    }
    
    init() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x87CEEB);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        const initialFogDist = this.world.renderDistance * 16 * 0.9;
        this.scene.fog = new THREE.Fog(0x87CEEB, 0, initialFogDist);
        this.fogRange.value = initialFogDist;
        this.fogValue.textContent = Math.round(initialFogDist);

        this.ambientLight = new THREE.AmbientLight(0xcccccc, 0.6);
        this.scene.add(this.ambientLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.directionalLight.position.set(1, 1, 0.5).normalize();
        this.directionalLight.castShadow = true;
        const shadowMapSize = 40;
        this.directionalLight.shadow.camera.left = -shadowMapSize;
        this.directionalLight.shadow.camera.right = shadowMapSize;
        this.directionalLight.shadow.camera.top = shadowMapSize;
        this.directionalLight.shadow.camera.bottom = -shadowMapSize;
        this.directionalLight.shadow.camera.near = 0.5;
        this.directionalLight.shadow.camera.far = 500;
        this.directionalLight.shadow.mapSize.width = 2048;
        this.directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(this.directionalLight);

        this.timeManager = new TimeManager(this.scene, this.renderer, this.directionalLight, this.ambientLight);
        this.skyboxManager = new SkyboxManager(this.scene, this.renderer, this.camera, this.timeManager);
        this.timeManager.setSkyboxManager(this.skyboxManager);
        this.renderer.autoClear = false;

        window.addEventListener('resize', this.onWindowResize.bind(this));
        window.addEventListener('beforeunload', () => this.cleanup());

        this.setupDevMenu();
        this.setupKeyBindings();
        this.setupAudio();
        this.initialWorldLoad();
    }

    async setupAudio() {
        this.updateLoadingProgress(1, "Loading audio...");
        const soundsToLoad = {
            'break': './sounds/break_block.wav',
            'place': './sounds/place_block.wav',
            'jump': './sounds/jump.wav',
            'footstep': './sounds/footstep.wav'
        };
        try {
            await this.audioManager.loadSounds(soundsToLoad);
            this.audioManager.loadMusicPlaylist(['./sounds/subwoofer.mp3'], 0.2);
        } catch (error) {
            console.error("Failed to load audio assets.", error);
        }
    }

    setupKeyBindings() {
        window.addEventListener('keydown', (e) => {
            const blockKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];
            const blockTypes = [
                BlockTypes.DIRT, BlockTypes.GRASS, BlockTypes.SAND, BlockTypes.LOG, 
                BlockTypes.LEAVES, BlockTypes.WATER, BlockTypes.STONE, BlockTypes.GRAVEL, BlockTypes.COAL_ORE
            ];
            const keyIndex = blockKeys.indexOf(e.code);
            if (keyIndex !== -1) {
                this.selectBlock(blockTypes[keyIndex]);
                return;
            }
            if (e.code === 'KeyE' && !this._devMenuOpen) {
                this._inventoryOpen = !this._inventoryOpen;
                if (this.inventoryUI) this.inventoryUI.style.display = this._inventoryOpen ? 'block' : 'none';
                if (this._inventoryOpen) document.exitPointerLock();
            }
        });
    }

    setupDevMenu() {
        if (!this.devMenu) return;
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Backslash' && !this._devMenuOpen && !this._inventoryOpen) {
                this._devMenuOpen = true;
                this.devMenu.style.display = 'block';
                document.exitPointerLock();
            } else if (e.code === 'Escape') {
                if (this._devMenuOpen) {
                    this._devMenuOpen = false;
                    this.devMenu.style.display = 'none';
                }
                if (this._inventoryOpen) {
                    this._inventoryOpen = false;
                    if (this.inventoryUI) this.inventoryUI.style.display = 'none';
                }
            }
        });
        this.closeDevMenuBtn.addEventListener('click', () => {
            this._devMenuOpen = false;
            this.devMenu.style.display = 'none';
        });
        this.toggleFlyBtn.addEventListener('click', () => {
            const isFlying = this.player.toggleFly();
            this.toggleFlyBtn.textContent = `Toggle Fly (${isFlying ? 'On' : 'Off'})`;
        });
        this.renderDistanceSlider.addEventListener('input', () => {
            const distance = parseInt(this.renderDistanceSlider.value, 10);
            this.renderValue.textContent = distance;
            this.world.setRenderDistance(distance);
            const newFog = distance * 16 * 0.9;
            this.scene.fog.far = newFog;
            this.fogRange.value = newFog;
            this.fogValue.textContent = Math.round(newFog);
            this.updateWorldChunks();
        });
        this.fogRange.addEventListener('input', () => {
            const far = parseInt(this.fogRange.value, 10);
            this.scene.fog.far = far;
            this.fogValue.textContent = far;
        });
    }

    updateLoadingProgress(percentage, message) {
        if (this.loadingProgress) this.loadingProgress.textContent = message;
        if (this.loadingProgressBar) this.loadingProgressBar.style.width = `${percentage}%`;
    }

    async initialWorldLoad() {
        this.updateLoadingProgress(5, "Initializing world worker...");
        await new Promise(resolve => {
            const checkWorkerReady = () => {
                if (this.workerReady) resolve();
                else setTimeout(checkWorkerReady, 100);
            };
            checkWorkerReady();
        });

        this.updateLoadingProgress(10, "Generating spawn area...");
        const initialLoadSize = 3;
        const promises = [];
        const totalChunks = Math.pow(initialLoadSize * 2 + 1, 2);
        let chunksGenerated = 0;

        for (let x = -initialLoadSize; x <= initialLoadSize; x++) {
            for (let z = -initialLoadSize; z <= initialLoadSize; z++) {
                const chunk = this.world.getChunk(x, z);
                const p = new Promise(resolve => {
                    const checkGenerated = () => {
                        if (chunk.generated) {
                            chunksGenerated++;
                            const progress = 10 + (chunksGenerated / totalChunks) * 60;
                            this.updateLoadingProgress(progress, `Generating Chunks... (${chunksGenerated}/${totalChunks})`);
                            resolve();
                        } else {
                            setTimeout(checkGenerated, 50);
                        }
                    };
                    checkGenerated();
                });
                promises.push(p);
            }
        }
        await Promise.all(promises);

        this.updateLoadingProgress(75, "Building world geometry...");
        this.updateChunkMeshes();
        await new Promise(resolve => {
            const checkSpawnChunk = () => {
                const spawnChunk = this.world.getChunk(0, 0);
                if (spawnChunk && spawnChunk.mesh) {
                    resolve();
                } else {
                    this.updateChunkMeshes();
                    setTimeout(checkSpawnChunk, 100);
                }
            };
            checkSpawnChunk();
        });

        this.updateLoadingProgress(95, "Finding a safe place to land...");
        let spawnPos = null;
        const maxSearchRadius = 32;
        for (let radius = 0; radius < maxSearchRadius && !spawnPos; radius++) {
            for (let i = -radius; i <= radius && !spawnPos; i++) {
                for (let j = -radius; j <= radius && !spawnPos; j++) {
                    if (Math.abs(i) !== radius && Math.abs(j) !== radius) continue;
                    const checkX = i, checkZ = j;
                    let groundY = -1;
                    for (let y = CHUNK_HEIGHT - 1; y > 0; y--) {
                        const block = this.world.getBlock(checkX, y, checkZ);
                        if (block !== BlockTypes.AIR && block !== BlockTypes.WATER && block !== BlockTypes.LEAVES) {
                            groundY = y;
                            break;
                        }
                    }
                    if (groundY > WATER_LEVEL) {
                        const surfaceBlock = this.world.getBlock(checkX, groundY, checkZ);
                        if (surfaceBlock === BlockTypes.GRASS || surfaceBlock === BlockTypes.SAND) {
                            const blockAbove1 = this.world.getBlock(checkX, groundY + 1, checkZ);
                            const blockAbove2 = this.world.getBlock(checkX, groundY + 2, checkZ);
                            if (blockAbove1 === BlockTypes.AIR && blockAbove2 === BlockTypes.AIR) {
                                spawnPos = { x: checkX, y: groundY, z: checkZ };
                            }
                        }
                    }
                }
            }
        }
        if (!spawnPos) {
            console.warn("Could not find a safe spawn point! Defaulting to origin.");
            spawnPos = { x: 0, y: 60, z: 0 };
        }
        this.player.position.set(spawnPos.x + 0.5, spawnPos.y + 1, spawnPos.z + 0.5);

        this.updateLoadingProgress(100, "Done!");
        setTimeout(() => {
            document.body.classList.add('loaded');
            this.animate();
        }, 600);
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        const deltaTime = this.clock.getDelta();

        if (this.timeManager) {
            this.timeManager.update(deltaTime, this.player.position);
            const fogColor = this.timeManager.getFogColor();
            this.scene.fog.color.copy(fogColor);
        }

        this.audioManager.update(deltaTime);

        if (!this._devMenuOpen && !this._inventoryOpen) {
            this.player.update(deltaTime);
            this.mobManager.update(deltaTime, this.player.position);
        }
        
        const shadowTarget = this.player.position.clone();
        this.directionalLight.target.position.copy(shadowTarget);
        this.directionalLight.position.copy(shadowTarget).add(this.timeManager.sunLight.position);
        this.directionalLight.target.updateMatrixWorld();
        
        const now = performance.now();
        if (now - this.lastChunkUpdate > 500) {
            this.updateWorldChunks();
            this.updateChunkMeshes();
            this.lastChunkUpdate = now;
        }

        if (now - this.lastHUDUpdate > 250) {
            this.updateHUD(deltaTime);
            this.lastHUDUpdate = now;
        }

        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
    }



    updateWorldChunks() {
        const loadedCount = this.world.updateLoadedChunks(this.player.position.x, this.player.position.z);
        const { x, z } = worldToChunkCoords(this.player.position.x, this.player.position.z);
        this.hud.chunkInfo.textContent = `Chunk: (${x}, ${z}) | Loaded: ${loadedCount}`;
    }

    updateChunkMeshes() {
        for (const chunk of this.world.chunks.values()) {
            // --- MODIFIED: Condition now checks for needsRemesh flag OR if it has no mesh ---
            if ((chunk.generated && !chunk.mesh) || chunk.needsRemesh) {
                if (!chunk.isMeshing) {
                    const neighbors = {
                        north: this.world.getChunk(chunk.x, chunk.z + 1),
                        south: this.world.getChunk(chunk.x, chunk.z - 1),
                        east: this.world.getChunk(chunk.x + 1, chunk.z),
                        west: this.world.getChunk(chunk.x - 1, chunk.z),
                    };

                    const allNeighborsReady = Object.values(neighbors).every(n => n && n.generated);

                    if (allNeighborsReady) {
                        chunk.isMeshing = true;
                        chunk.needsRemesh = false; // Reset the flag
                        
                        const neighborData = {
                            north: neighbors.north.blocks,
                            south: neighbors.south.blocks,
                            east: neighbors.east.blocks,
                            west: neighbors.west.blocks,
                        };
                        
                        this.worldWorker.postMessage({
                            cmd: 'meshChunk',
                            data: {
                                chunkX: chunk.x,
                                chunkZ: chunk.z,
                                chunkData: chunk.blocks,
                                neighborData: neighborData
                            }
                        });
                    }
                }
            }
        }
    }

    updateHUD(deltaTime) {
        this.hud.fps.textContent = `FPS: ${Math.round(1 / deltaTime)}`;
        const pos = this.player.position;
        this.hud.position.textContent = `Pos: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;
        if (this.timeManager) {
            this.hud.time.textContent = `Time: ${this.timeManager.getFormattedTime()}`;
        }
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    cleanup() {
        this.mobManager.cleanup();
        this.audioManager.cleanup();
        if (this.skyboxManager) {
            this.skyboxManager.cleanup();
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    game.init();
});