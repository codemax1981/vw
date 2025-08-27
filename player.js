// player.js

import { BlockTypes } from './utils.js';

export class Player {
    constructor(camera, world) {
        this.camera = camera;
        this.world = world;
        this.position = new THREE.Vector3(0, 50, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.onGround = false;
        
        // --- NEW PROPERTIES ---
        this.isFlying = false;
        this.flySpeed = 15.0;
        // --- END NEW PROPERTIES ---

        this.speed = 5.0;
        this.jumpSpeed = 8.0;
        this.gravity = -20.0;
        this.mouseSensitivity = 0.002;
        
        // Player dimensions
        this.width = 0.6;
        this.height = 1.8;
        this.depth = 0.6;
        
        // Camera and movement
        this.pitch = 0;
        this.yaw = 0;
        this.keys = {};
        this.mouseMovement = { x: 0, y: 0 };
        
        // Collision settings
        this.stepHeight = 0.6;
        this.skinWidth = 0.015;
        
        this.setupControls();
    }

    setupControls() {
        document.addEventListener('keydown', (e) => this.keys[e.code] = true);
        document.addEventListener('keyup', (e) => this.keys[e.code] = false);
        document.addEventListener('click', () => document.body.requestPointerLock());
        document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === document.body) {
                this.mouseMovement.x += e.movementX;
                this.mouseMovement.y += e.movementY;
            }
        });
    }

    // --- NEW METHOD ---
    toggleFly() {
        this.isFlying = !this.isFlying;
        // Reset vertical velocity when stopping flight to prevent falling
        if (!this.isFlying) {
            this.velocity.y = 0;
        }
        return this.isFlying;
    }

    update(deltaTime) {
        this.handleMouseLook();
        
        // --- UPDATED LOGIC ---
        if (this.isFlying) {
            this.handleFlyMovement(deltaTime);
        } else {
            this.handleMovement(deltaTime);
            this.applyPhysics(deltaTime);
        }
        // --- END UPDATED LOGIC ---

        this.updateCameraPosition();
    }

    handleMouseLook() {
        this.yaw -= this.mouseMovement.x * this.mouseSensitivity;
        this.pitch -= this.mouseMovement.y * this.mouseSensitivity;
        this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
        this.mouseMovement.x = 0;
        this.mouseMovement.y = 0;
    }

    // --- NEW METHOD for flying ---
    handleFlyMovement(deltaTime) {
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward); // Use camera direction for up/down movement
        const right = new THREE.Vector3().crossVectors(this.camera.up, forward).normalize();
        const moveVector = new THREE.Vector3();

        if (this.keys['KeyW']) moveVector.add(forward);
        if (this.keys['KeyS']) moveVector.sub(forward);
        if (this.keys['KeyD']) moveVector.add(right);
        if (this.keys['KeyA']) moveVector.sub(right);
        if (this.keys['Space']) moveVector.y += 1;
        if (this.keys['ShiftLeft']) moveVector.y -= 1;

        if (moveVector.length() > 0) {
            moveVector.normalize();
        }

        // Flying is like noclip, we move directly without physics/collision
        this.position.add(moveVector.multiplyScalar(this.flySpeed * deltaTime));
    }

    handleMovement(deltaTime) {
        const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const moveVector = new THREE.Vector3();

        if (this.keys['KeyW']) moveVector.add(forward);
        if (this.keys['KeyS']) moveVector.sub(forward);
        if (this.keys['KeyD']) moveVector.add(right);
        if (this.keys['KeyA']) moveVector.sub(right);

        if (moveVector.length() > 0) moveVector.normalize().multiplyScalar(this.speed);

        this.velocity.x = moveVector.x;
        this.velocity.z = moveVector.z;

        if (this.keys['Space'] && this.onGround) {
            this.velocity.y = this.jumpSpeed;
            this.onGround = false;
        }
    }

    // ... (rest of the file is unchanged)
    applyPhysics(deltaTime) {
        // Apply gravity
        this.velocity.y += this.gravity * deltaTime;
        
        // Store the previous position
        const oldPosition = this.position.clone();
        
        // Reset ground state
        this.onGround = false;

        // Move horizontally first (X and Z together)
        this.moveHorizontally(deltaTime);
        
        // Then move vertically
        this.moveVertically(deltaTime);

        // Safety check - if player gets stuck or moved too far, revert
        const movementDistance = this.position.distanceTo(oldPosition);
        if (movementDistance > this.speed * deltaTime * 2 + Math.abs(this.velocity.y * deltaTime) + 2) {
            console.warn('Excessive movement detected, reverting position');
            this.position.copy(oldPosition);
            this.velocity.set(0, 0, 0);
        }

        // Reset if player falls through world
        if (this.position.y < -10) {
            this.position.set(0, 50, 0);
            this.velocity.set(0, 0, 0);
        }
    }

    moveHorizontally(deltaTime) {
        const horizontalVelocity = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
        const horizontalMovement = horizontalVelocity.clone().multiplyScalar(deltaTime);
        
        if (horizontalMovement.length() < 0.001) return;

        const newPosition = this.position.clone().add(horizontalMovement);
        
        // Check collision at new position
        if (this.canMoveTo(newPosition)) {
            this.position.copy(newPosition);
            return;
        }

        // Try step-up if grounded
        if (this.onGround || this.isOnGround()) {
            const stepUpPos = newPosition.clone();
            stepUpPos.y += this.stepHeight;
            
            if (this.canMoveTo(stepUpPos)) {
                // Find the exact step height needed
                for (let step = 0.1; step <= this.stepHeight; step += 0.1) {
                    const testPos = newPosition.clone();
                    testPos.y += step;
                    
                    if (this.canMoveTo(testPos)) {
                        this.position.copy(testPos);
                        return;
                    }
                }
            }
        }

        // Try sliding along walls - test X and Z axes separately
        const xMovement = new THREE.Vector3(horizontalMovement.x, 0, 0);
        const zMovement = new THREE.Vector3(0, 0, horizontalMovement.z);

        const xPos = this.position.clone().add(xMovement);
        const zPos = this.position.clone().add(zMovement);

        if (this.canMoveTo(xPos)) {
            this.position.copy(xPos);
        } else if (this.canMoveTo(zPos)) {
            this.position.copy(zPos);
            this.velocity.x = 0; // Stop X movement if hitting wall
        } else {
            // Can't move in either direction, stop horizontal movement
            this.velocity.x = 0;
            this.velocity.z = 0;
        }
    }

    moveVertically(deltaTime) {
        const verticalMovement = this.velocity.y * deltaTime;
        
        if (Math.abs(verticalMovement) < 0.001) {
            // Check if we're on ground even without movement
            this.onGround = this.isOnGround();
            return;
        }

        const newPosition = this.position.clone();
        newPosition.y += verticalMovement;

        if (this.canMoveTo(newPosition)) {
            this.position.copy(newPosition);
            this.onGround = false;
        } else {
            // Collision detected
            if (this.velocity.y < 0) {
                // Falling - hit ground
                this.onGround = true;
                this.position.y = this.findGroundLevel();
            } else {
                // Rising - hit ceiling
                this.position.y = this.findCeilingLevel();
            }
            this.velocity.y = 0;
        }
    }

    canMoveTo(position) {
        const bounds = this.getBounds(position);
        
        // Check all blocks within the player's bounding box
        for (let x = Math.floor(bounds.min.x); x <= Math.floor(bounds.max.x); x++) {
            for (let y = Math.floor(bounds.min.y); y <= Math.floor(bounds.max.y); y++) {
                for (let z = Math.floor(bounds.min.z); z <= Math.floor(bounds.max.z); z++) {
                    if (this.isBlockSolid(x, y, z)) {
                        // Check if bounding box actually intersects with this block
                        if (this.intersectsBlock(bounds, x, y, z)) {
                            return false;
                        }
                    }
                }
            }
        }
        return true;
    }

    getBounds(position = this.position) {
        const halfWidth = this.width / 2;
        const halfDepth = this.depth / 2;
        
        return {
            min: {
                x: position.x - halfWidth + this.skinWidth,
                y: position.y + this.skinWidth,
                z: position.z - halfDepth + this.skinWidth
            },
            max: {
                x: position.x + halfWidth - this.skinWidth,
                y: position.y + this.height - this.skinWidth,
                z: position.z + halfDepth - this.skinWidth
            }
        };
    }

    intersectsBlock(bounds, blockX, blockY, blockZ) {
        return !(bounds.max.x <= blockX || bounds.min.x >= blockX + 1 ||
                bounds.max.y <= blockY || bounds.min.y >= blockY + 1 ||
                bounds.max.z <= blockZ || bounds.min.z >= blockZ + 1);
    }

    isOnGround() {
        const testPos = this.position.clone();
        testPos.y -= 0.1; // Check slightly below current position
        return !this.canMoveTo(testPos);
    }

    findGroundLevel() {
        // Find the exact Y position where player can stand
        for (let y = Math.floor(this.position.y); y >= Math.floor(this.position.y) - 2; y -= 0.1) {
            const testPos = this.position.clone();
            testPos.y = y;
            
            if (this.canMoveTo(testPos)) {
                return y;
            }
        }
        return this.position.y; // Fallback to current position
    }

    findCeilingLevel() {
        // Find the exact Y position below ceiling
        for (let y = Math.ceil(this.position.y + this.height); y <= Math.ceil(this.position.y + this.height) + 2; y += 0.1) {
            const testPos = this.position.clone();
            testPos.y = y - this.height;
            
            if (this.canMoveTo(testPos)) {
                return y - this.height;
            }
        }
        return this.position.y; // Fallback to current position
    }

    isBlockSolid(x, y, z) {
        const blockType = this.world.getBlock(x, y, z);
        return blockType !== BlockTypes.AIR && blockType !== BlockTypes.WATER;
    }

    updateCameraPosition() {
        this.camera.position.set(
            this.position.x, 
            this.position.y + this.height * 0.9, 
            this.position.z
        );
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
    }

    // Utility method for debugging
    getDebugInfo() {
        return {
            position: this.position.clone(),
            velocity: this.velocity.clone(),
            onGround: this.onGround,
            bounds: this.getBounds()
        };
    }
}