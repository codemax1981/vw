// main.js

import { World } from './world.js';
import { Player } from './player.js';
import { ChunkMesher } from './mesher.js';
import { MobManager } from './mobs.js';
import { worldToChunkCoords, BlockTypes } from './utils.js';


class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);
        this.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true });

        // Initialize worker
        this.worldWorker = new Worker('./world-worker.js');
        this.workerReady = false;
        this.setupWorker();

        this.world = new World(this.worldWorker);
        this.player = new Player(this.camera, this.world);
        this.mesher = new ChunkMesher(this.world);
        this.mobManager = new MobManager(this.scene, this.world);

        this.hud = {
            fps: document.getElementById('fps'),
            position: document.getElementById('position'),
            chunkInfo: document.getElementById('chunkInfo'),
        };

        this.loadingScreen = document.getElementById('loading');
        this.loadingProgress = document.getElementById('loadingProgress');
        this.loadingProgressBar = document.getElementById('progressBar');

        this.clock = new THREE.Clock();
        this.lastChunkUpdate = 0;
        this.lastHUDUpdate = 0;

        // Dev menu fields
        this.devMenu = document.getElementById('devMenu');
        this.fogRange = document.getElementById('fogRange');
        this.fogValue = document.getElementById('fogValue');
        this.closeDevMenuBtn = document.getElementById('closeDevMenu');
        this._devMenuOpen = false;

        // Tool and inventory system
        this.inventoryUI = document.getElementById('inventoryUI');
        this.blockSelector = document.getElementById('blockSelector');
        this.selectedItemDisplay = document.getElementById('selectedBlockDisplay');
        this._inventoryOpen = false;
        this.selectedBlockType = BlockTypes.DIRT;
        
       

        this.blockNames = {
            [BlockTypes.DIRT]: 'Dirt',
            [BlockTypes.GRASS]: 'Grass',
            [BlockTypes.SAND]: 'Sand',
            [BlockTypes.LOG]: 'Log',
            [BlockTypes.LEAVES]: 'Leaves',
            [BlockTypes.WATER]: 'Water'
        };

        this.blockColors = {
            [BlockTypes.DIRT]: '#8B4513',
            [BlockTypes.GRASS]: '#228B22',
            [BlockTypes.SAND]: '#F4A460',
            [BlockTypes.LOG]: '#654321',
            [BlockTypes.LEAVES]: '#32CD32',
            [BlockTypes.WATER]: '#4169E1'
        };

        // Raycasting for block interaction
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.maxReach = 5; // Maximum reach distance

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
            }

            // Forward to world
            if (this.world && this.world.onWorkerMessage) {
                this.world.onWorkerMessage(e.data);
            }
        };

        // Initialize worker with seed
        this.worldWorker.postMessage({
            cmd: 'init',
            data: { seed: Date.now() }
        });
    }
    

    setupMouseEvents() {
        // Improved pointer lock request
        document.addEventListener('click', () => {
            if (document.pointerLockElement !== document.body &&
                !this._devMenuOpen && !this._inventoryOpen) {
                document.body.requestPointerLock();
            }
        });

        // Mouse events - make sure they're on the right element
        document.addEventListener('mousedown', (e) => {
            if (document.pointerLockElement !== document.body) return;
            if (this._devMenuOpen || this._inventoryOpen) return;

            e.preventDefault();
            if (e.button === 0) { // Left click - attack/break block
                console.log('Left click detected - using tool');
                this.breakBlock();
            } else if (e.button === 2) { // Right click - place block
                console.log('Right click detected - placing block');
                this.placeBlock();
            }
        });

        // Prevent context menu
        document.addEventListener('contextmenu', (e) => {
            if (document.pointerLockElement === document.body) {
                e.preventDefault();
            }
        });
    }

    breakBlock() {
        const tgt = this.getTargetBlock();
        if (!tgt) return;                       // nothing hit
        if (tgt.type === BlockTypes.WATER) return;   // optional rule
      
        // update world data
        this.world.setBlock(tgt.x, tgt.y, tgt.z, BlockTypes.AIR);
      
        // instantly rebuild this chunk and any neighbours on chunk edge
        this.markChunkForRemesh(tgt.x, tgt.y, tgt.z);
      }
      


    setupInventory() {
        if (!this.blockSelector) return;

        // Setup block selection
        const blockItems = this.blockSelector.querySelectorAll('.block-item');
        blockItems.forEach(item => {
            item.addEventListener('click', () => {
                const blockType = parseInt(item.dataset.block);
                this.selectBlock(blockType);
            });
        });

        // Select first block by default
        this.selectBlock(BlockTypes.DIRT);
    }

    selectBlock(blockType) {
        this.selectedBlockType = blockType;
        
        if (this.blockSelector) {
            // Update visual selection
            const blockItems = this.blockSelector.querySelectorAll('.block-item');
            blockItems.forEach(item => {
                item.classList.toggle('selected', parseInt(item.dataset.block) === blockType);
            });
        }
    
        // Always update the selected item display
        if (this.selectedItemDisplay) {
            this.selectedItemDisplay.style.backgroundColor = this.blockColors[blockType];
            this.selectedItemDisplay.textContent = this.blockNames[blockType];
        }
    }
    

    getTargetBlock() {
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        const origin = this.camera.position.clone();

        // Use smaller steps for better precision
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
                console.log(`Found target block at (${blockX}, ${blockY}, ${blockZ}) type: ${blockType}`);
                return { x: blockX, y: blockY, z: blockZ, type: blockType };
            }
        }

        console.log('No target block found');
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

    placeBlock() {
        const placePos = this.getPlacePosition();
        if (!placePos) {
            console.log('No valid place position found');
            return;
        }

        console.log('Placing block at:', placePos, 'type:', this.selectedBlockType);

        // Check if there's already a block there
        const existingBlock = this.world.getBlock(placePos.x, placePos.y, placePos.z);
        if (existingBlock !== BlockTypes.AIR) {
            console.log('Space already occupied by block type:', existingBlock);
            return;
        }

        // Simple check: only prevent placing blocks at the exact same position as player's feet or head
        const playerPos = this.player.position;
        const playerBlockX = Math.floor(playerPos.x);
        const playerBlockY = Math.floor(playerPos.y);
        const playerBlockZ = Math.floor(playerPos.z);
        const playerHeadY = Math.floor(playerPos.y + this.player.height);

        // Don't place blocks where the player is standing or where their head is
        if (placePos.x === playerBlockX && placePos.z === playerBlockZ &&
            (placePos.y === playerBlockY || placePos.y === playerHeadY)) {
            console.log('Cannot place block inside player');
            return;
        }

        // Place the block
        this.world.setBlock(placePos.x, placePos.y, placePos.z, this.selectedBlockType);
        console.log('Block placed successfully, remeshing...');

        // Force immediate remesh
        this.markChunkForRemesh(placePos.x, placePos.y, placePos.z);
    }

    markChunkForRemesh(worldX, worldY, worldZ) {
        const { x: chunkX, z: chunkZ } = worldToChunkCoords(worldX, worldZ);
        this.remeshChunk(chunkX, chunkZ);

        // Also remesh neighboring chunks if block is on edge
        const localX = worldX - chunkX * 16;
        const localZ = worldZ - chunkZ * 16;

        if (localX === 0) this.remeshChunk(chunkX - 1, chunkZ);
        if (localX === 15) this.remeshChunk(chunkX + 1, chunkZ);
        if (localZ === 0) this.remeshChunk(chunkX, chunkZ - 1);
        if (localZ === 15) this.remeshChunk(chunkX, chunkZ + 1);
    }

    remeshChunk(chunkX, chunkZ) {
        const chunk = this.world.getChunk(chunkX, chunkZ);
        if (!chunk || !chunk.generated) return;

        // Remove existing mesh
        if (chunk.mesh) {
            this.scene.remove(chunk.mesh);
            chunk.mesh.children.forEach(child => {
                child.geometry?.dispose();
            });
            chunk.mesh = null;
        }

        // Create new mesh immediately
        const newMesh = this.mesher.meshChunk(chunk);
        if (newMesh) {
            chunk.mesh = newMesh;
            this.scene.add(chunk.mesh);
        }
    }

    init() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x87CEEB);

        this.scene.fog = new THREE.Fog(0x87CEEB, 0, this.world.renderDistance * 16 * 0.9);

        const ambientLight = new THREE.AmbientLight(0xcccccc, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 0.5).normalize();
        this.scene.add(directionalLight);

        window.addEventListener('resize', this.onWindowResize.bind(this));

        this.setupDevMenu();
        this.setupKeyBindings();
        this.initialWorldLoad();
    }

    setupKeyBindings() {
        window.addEventListener('keydown', (e) => {
            // Block type selection (1-6)
            const blockKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
            const blockTypes = [BlockTypes.DIRT, BlockTypes.GRASS, BlockTypes.SAND, BlockTypes.LOG, BlockTypes.LEAVES, BlockTypes.WATER];

            const keyIndex = blockKeys.indexOf(e.code);
            if (keyIndex !== -1) {
                this.selectBlock(blockTypes[keyIndex]);
                return;
            }

            // Inventory toggle
            if (e.code === 'KeyE' && !this._devMenuOpen) {
                this._inventoryOpen = !this._inventoryOpen;
                if (this.inventoryUI) {
                    this.inventoryUI.style.display = this._inventoryOpen ? 'block' : 'none';
                }
                
                if (this._inventoryOpen) {
                    document.exitPointerLock();
                }
                return;
            }
        });
    }

    setupDevMenu() {
        // Only bind if elements exist
        if (!(this.devMenu && this.fogRange && this.fogValue && this.closeDevMenuBtn)) return;

        // Show dev menu on Backslash
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Backslash' && !this._devMenuOpen && !this._inventoryOpen) {
                this._devMenuOpen = true;
                this.devMenu.style.display = 'block';
                this.fogRange.value = Math.round(this.scene.fog.far);
                this.fogValue.textContent = Math.round(this.scene.fog.far);
                document.exitPointerLock();
            } else if (e.code === 'Escape') {
                if (this._devMenuOpen) {
                    this._devMenuOpen = false;
                    this.devMenu.style.display = 'none';
                }

                if (this._inventoryOpen) {
                    this._inventoryOpen = false;
                    if (this.inventoryUI) {
                        this.inventoryUI.style.display = 'none';
                    }
                }
            }
        });

        // Live update fog as user slides
        this.fogRange.addEventListener('input', () => {
            const far = parseInt(this.fogRange.value, 10);
            this.scene.fog.far = far;
            this.fogValue.textContent = far;
        });

        // Close button
        this.closeDevMenuBtn.addEventListener('click', () => {
            this._devMenuOpen = false;
            this.devMenu.style.display = 'none';
        });
    }

    updateLoadingProgress(percentage, message) {
        if (this.loadingProgress) this.loadingProgress.textContent = message;
        if (this.loadingProgressBar) this.loadingProgressBar.style.width = `${percentage}%`;
    }

    async initialWorldLoad() {
        // --- Stage 1: Wait for the world worker to be ready ---
        this.updateLoadingProgress(5, "Initializing world worker...");
        await new Promise(resolve => {
            const checkWorkerReady = () => {
                if (this.workerReady) resolve();
                else setTimeout(checkWorkerReady, 100);
            };
            checkWorkerReady();
        });

        // --- Stage 2: Asynchronously generate the initial spawn chunks ---
        this.updateLoadingProgress(10, "Generating spawn area...");
        const initialLoadSize = 3; // A 7x7 chunk area
        const promises = [];
        const totalChunks = Math.pow(initialLoadSize * 2 + 1, 2);
        let chunksGenerated = 0;

        for (let x = -initialLoadSize; x <= initialLoadSize; x++) {
            for (let z = -initialLoadSize; z <= initialLoadSize; z++) {
                // This call requests the chunk from the worker
                const chunk = this.world.getChunk(x, z);

                // Create a promise that resolves when this specific chunk is generated
                const p = new Promise(resolve => {
                    const checkGenerated = () => {
                        if (chunk.generated) {
                            chunksGenerated++;
                            const progress = 10 + (chunksGenerated / totalChunks) * 60; // Allocate 60% of bar to generation
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
        await Promise.all(promises); // Wait for all generation promises to complete

        // --- Stage 3: Build the initial geometry (meshing) ---
        this.updateLoadingProgress(75, "Building world geometry...");
        // A brief pause to allow the UI to update before the potentially blocking mesh operation
        await new Promise(resolve => setTimeout(resolve, 50)); 
        this.updateChunkMeshes();

        // --- Stage 4: Finalize and spawn the player ---
        this.updateLoadingProgress(95, "Finding a safe place to land...");
        let spawnY = 63;
        while (this.world.getBlock(0, spawnY, 0) === 0 && spawnY > 0) spawnY--;
        this.player.position.set(0.5, spawnY + 2, 0.5);

        this.updateLoadingProgress(100, "Done!");

        // --- Fade out the loading screen and start the game ---
        setTimeout(() => {
            document.body.classList.add('loaded');
            this.animate();
        }, 600); // Give a moment for the user to see "Done!"
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));

        const deltaTime = this.clock.getDelta();

        // Pause game updates when dev menu or inventory is open
        if (!this._devMenuOpen && !this._inventoryOpen) {
            this.player.update(deltaTime);
            this.mobManager.update(deltaTime, this.player.position);
        }

        

        const now = performance.now();

        if (now - this.lastChunkUpdate > 1000) {
            this.updateWorldChunks();
            this.updateChunkMeshes();
            this.lastChunkUpdate = now;
        }

        if (now - this.lastHUDUpdate > 250) {
            this.updateHUD(deltaTime);
            this.lastHUDUpdate = now;
        }

        this.renderer.render(this.scene, this.camera);
    }

    updateWorldChunks() {
        const loadedCount = this.world.updateLoadedChunks(this.player.position.x, this.player.position.z);
        const { x, z } = worldToChunkCoords(this.player.position.x, this.player.position.z);
        this.hud.chunkInfo.textContent = `Chunk: (${x}, ${z}) | Loaded: ${loadedCount}`;
    }

    updateChunkMeshes() {
        for (const chunk of this.world.getLoadedChunks()) {
            if (!chunk.mesh) {
                // --- FIX STARTS HERE ---
                // Before meshing, ensure all direct neighbors are generated.
                // This prevents visual holes at chunk borders (race conditions).
                let neighborsReady = true;
                const neighbors = [
                    this.world.getChunk(chunk.x - 1, chunk.z),
                    this.world.getChunk(chunk.x + 1, chunk.z),
                    this.world.getChunk(chunk.x, chunk.z - 1),
                    this.world.getChunk(chunk.x, chunk.z + 1),
                ];

                for (const neighbor of neighbors) {
                    if (!neighbor || !neighbor.generated) {
                        neighborsReady = false;
                        break;
                    }
                }

                if (neighborsReady) {
                    const mesh = this.mesher.meshChunk(chunk);
                    if (mesh) {
                        chunk.mesh = mesh;
                        this.scene.add(chunk.mesh);
                    }
                }
                // --- FIX ENDS HERE ---
            }
        }
    }

    updateHUD(deltaTime) {
        this.hud.fps.textContent = `FPS: ${Math.round(1 / deltaTime)}`;
        const pos = this.player.position;
        this.hud.position.textContent = `Pos: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    cleanup() {
        this.mobManager.cleanup();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    game.init();
});