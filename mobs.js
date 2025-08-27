// mobs.js
import { BlockTypes, CHUNK_HEIGHT } from './utils.js';

// A simple state machine for our AI
const AIState = {
    IDLE: 'idle',
    WANDERING: 'wandering',
    NAVIGATING_OBSTACLE: 'navigating_obstacle'
};

export const MobTypes = {
    COW: 'cow',
    SHEEP: 'sheep',
    PIG: 'pig'
};

export class Mob {
    constructor(type, position, world) {
        this.type = type;
        this.position = position.clone();
        this.velocity = new THREE.Vector3();
        this.world = world;
        this.mesh = null;
        this.health = 100;
        this.maxHealth = 100;
        this.speed = 1.5;
        this.jumpSpeed = 6;
        this.gravity = -15;
        this.onGround = false;
        this.width = 0.8;
        this.height = 1.2;
        
        // --- AI Behavior ---
        this.state = AIState.IDLE;
        this.wanderTarget = null;
        this.navigationTarget = null; // Short-term target for obstacle avoidance
        this.wanderRadius = 16; // Increased wander radius for more movement
        this.spawnPosition = position.clone();
        this.timeInCurrentState = 0;
        this.maxIdleTime = 5; // seconds
        this.maxWanderTime = 15; // seconds

        // Cooldown for expensive checks to improve performance
        this.obstacleCheckCooldown = 0;
        this.obstacleCheckInterval = 0.2; // Check for obstacles 5 times per second
        
        // Animation
        this.currentAnimation = 'idle';
        
        this.createMesh();
    }

    createMesh() {
        const group = new THREE.Group();

        switch (this.type) {
            case MobTypes.COW:
                this.createCowMesh(group);
                break;
            case MobTypes.SHEEP:
                this.createSheepMesh(group);
                break;
            case MobTypes.PIG:
                this.createPigMesh(group);
                break;
            default:
                this.createCowMesh(group); // Default to cow
        }
        
        group.position.copy(this.position);
        this.mesh = group;
    }

    createCowMesh(group) {
        const bodyColor = 0x4d3220;
        const headColor = 0x4d3220;
        const legColor = 0x1e1a18;
        const hornColor = 0xe0e0e0;
        const udderColor = 0xffb6c1;
        const tailColor = 0x3a2314;
        const eyeColor = 0x000000;
        const noseColor = 0x8a6f5e;

        // Materials
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: bodyColor });
        const headMaterial = new THREE.MeshLambertMaterial({ color: headColor });
        const legMaterial = new THREE.MeshLambertMaterial({ color: legColor });
        const hornMaterial = new THREE.MeshLambertMaterial({ color: hornColor });
        const udderMaterial = new THREE.MeshLambertMaterial({ color: udderColor });
        const tailMaterial = new THREE.MeshLambertMaterial({ color: tailColor });
        const eyeMaterial = new THREE.MeshLambertMaterial({ color: eyeColor });
        const noseMaterial = new THREE.MeshLambertMaterial({ color: noseColor });

        // Body
        const bodyWidth = 0.8, bodyHeight = 0.9, bodyDepth = 1.4;
        const bodyGeometry = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = bodyHeight / 2 + 0.5;
        group.add(body);
        this.bodyMesh = body;

        // Add simple white spots as separate geometries
        const spotGeometry = new THREE.BoxGeometry(0.3, 0.4, 0.01);
        const spotMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const leftSpot = new THREE.Mesh(spotGeometry, spotMaterial);
        leftSpot.position.set(-bodyWidth/2 - 0.005, body.position.y, 0.2);
        leftSpot.rotation.y = Math.PI / 2;
        group.add(leftSpot);

        const rightSpot = new THREE.Mesh(spotGeometry, spotMaterial);
        rightSpot.position.set(bodyWidth/2 + 0.005, body.position.y + 0.1, -0.3);
        rightSpot.rotation.y = Math.PI / 2;
        group.add(rightSpot);

        // Head
        const headSize = 0.6;
        const headGeometry = new THREE.BoxGeometry(headSize, headSize, headSize);
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.set(0, body.position.y + bodyHeight / 2 - 0.1, bodyDepth / 2 + headSize / 3);
        group.add(head);
        this.headMesh = head;

        // Nose
        const noseGeometry = new THREE.BoxGeometry(0.4, 0.25, 0.1);
        const nose = new THREE.Mesh(noseGeometry, noseMaterial);
        nose.position.set(0, -0.1, headSize / 2 + 0.05);
        head.add(nose);

        // Horns
        const hornGeometry = new THREE.BoxGeometry(0.1, 0.3, 0.1);
        const leftHorn = new THREE.Mesh(hornGeometry, hornMaterial);
        leftHorn.position.set(-headSize/3, headSize/2, 0);
        leftHorn.rotation.z = -Math.PI / 8;
        head.add(leftHorn);
        
        const rightHorn = new THREE.Mesh(hornGeometry, hornMaterial);
        rightHorn.position.set(headSize/3, headSize/2, 0);
        rightHorn.rotation.z = Math.PI / 8;
        head.add(rightHorn);

        // Eyes
        const eyeGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.05);
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-headSize/4, 0.1, headSize/2 + 0.025);
        head.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(headSize/4, 0.1, headSize/2 + 0.025);
        head.add(rightEye);

        // Udder
        const udderGeometry = new THREE.BoxGeometry(0.4, 0.2, 0.3);
        const udder = new THREE.Mesh(udderGeometry, udderMaterial);
        udder.position.set(0, body.position.y - bodyHeight / 2 - 0.1, -0.2);
        group.add(udder);

        // Tail
        const tailGeometry = new THREE.BoxGeometry(0.1, 0.5, 0.1);
        const tail = new THREE.Mesh(tailGeometry, tailMaterial);
        tail.position.set(0, body.position.y, -bodyDepth / 2 - 0.05);
        tail.rotation.x = Math.PI / 6;
        group.add(tail);

        // Legs
        const legLength = 0.5, legSize = 0.25;
        const legGeometry = new THREE.BoxGeometry(legSize, legLength, legSize);
        this.legs = [];
        const legPositions = [
            [-bodyWidth/2 + legSize/2, legLength/2, bodyDepth/2 - legSize/2],
            [bodyWidth/2 - legSize/2, legLength/2, bodyDepth/2 - legSize/2],
            [-bodyWidth/2 + legSize/2, legLength/2, -bodyDepth/2 + legSize/2],
            [bodyWidth/2 - legSize/2, legLength/2, -bodyDepth/2 + legSize/2],
        ];
        legPositions.forEach(pos => {
            const leg = new THREE.Mesh(legGeometry, legMaterial);
            leg.position.set(pos[0], pos[1], pos[2]);
            group.add(leg);
            this.legs.push(leg);
        });
    }

    createSheepMesh(group) {
        const woolColor = 0xe0e0e0;
        const faceColor = 0xffdab9;
        const legColor = 0x4a4a4a;
        const eyeColor = 0x000000;
        const earColor = 0xffdab9;

        // Materials
        const woolMaterial = new THREE.MeshLambertMaterial({ color: woolColor });
        const faceMaterial = new THREE.MeshLambertMaterial({ color: faceColor });
        const legMaterial = new THREE.MeshLambertMaterial({ color: legColor });
        const eyeMaterial = new THREE.MeshLambertMaterial({ color: eyeColor });
        const earMaterial = new THREE.MeshLambertMaterial({ color: earColor });

        // Woolly Body - make it fluffier with a larger box and added wool puffs
        const bodyWidth = 0.9, bodyHeight = 0.8, bodyDepth = 1.2;
        const bodyGeometry = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
        const body = new THREE.Mesh(bodyGeometry, woolMaterial);
        body.position.y = bodyHeight / 2 + 0.4;
        group.add(body);
        this.bodyMesh = body;

        // Add wool puffs for fluffiness
        const puffGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const puffPositions = [
            [0.3, body.position.y + 0.3, 0],
            [-0.3, body.position.y + 0.3, 0.2],
            [0, body.position.y + 0.3, -0.3],
        ];
        puffPositions.forEach(pos => {
            const puff = new THREE.Mesh(puffGeometry, woolMaterial);
            puff.position.set(pos[0], pos[1], pos[2]);
            group.add(puff);
        });

        // Head
        const headSize = 0.5;
        const headGeometry = new THREE.BoxGeometry(headSize, headSize, headSize * 0.8);
        const head = new THREE.Mesh(headGeometry, faceMaterial);
        head.position.set(0, body.position.y + bodyHeight / 2 - 0.1, bodyDepth / 2 + headSize / 3);
        group.add(head);
        this.headMesh = head;

        // Wool on head
        const headWoolGeometry = new THREE.BoxGeometry(headSize * 1.1, headSize * 0.4, headSize * 0.5);
        const headWool = new THREE.Mesh(headWoolGeometry, woolMaterial);
        headWool.position.set(0, headSize / 2 + 0.1, 0);
        head.add(headWool);

        // Eyes
        const eyeGeometry = new THREE.BoxGeometry(0.08, 0.08, 0.04);
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-headSize/4, 0.1, headSize * 0.4 + 0.02);
        head.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(headSize/4, 0.1, headSize * 0.4 + 0.02);
        head.add(rightEye);

        // Ears
        const earGeometry = new THREE.BoxGeometry(0.1, 0.2, 0.05);
        const leftEar = new THREE.Mesh(earGeometry, earMaterial);
        leftEar.position.set(-headSize/2 - 0.05, 0, 0);
        leftEar.rotation.y = Math.PI / 4;
        head.add(leftEar);

        const rightEar = new THREE.Mesh(earGeometry, earMaterial);
        rightEar.position.set(headSize/2 + 0.05, 0, 0);
        rightEar.rotation.y = -Math.PI / 4;
        head.add(rightEar);

        // Legs
        const legLength = 0.4, legSize = 0.2;
        const legGeometry = new THREE.BoxGeometry(legSize, legLength, legSize);
        this.legs = [];
        const legPositions = [
            [-bodyWidth/2 + legSize/2, legLength/2, bodyDepth/2 - legSize/2],
            [bodyWidth/2 - legSize/2, legLength/2, bodyDepth/2 - legSize/2],
            [-bodyWidth/2 + legSize/2, legLength/2, -bodyDepth/2 + legSize/2],
            [bodyWidth/2 - legSize/2, legLength/2, -bodyDepth/2 + legSize/2],
        ];
        legPositions.forEach(pos => {
            const leg = new THREE.Mesh(legGeometry, legMaterial);
            leg.position.set(pos[0], pos[1], pos[2]);
            group.add(leg);
            this.legs.push(leg);
        });
    }

    createPigMesh(group) {
        const bodyColor = 0xffc0cb;
        const snoutColor = 0xff69b4;
        const legColor = 0xc71585;
        const eyeColor = 0x000000;
        const earColor = 0xff69b4;
        const tailColor = 0xff69b4;

        // Materials
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: bodyColor });
        const snoutMaterial = new THREE.MeshLambertMaterial({ color: snoutColor });
        const legMaterial = new THREE.MeshLambertMaterial({ color: legColor });
        const eyeMaterial = new THREE.MeshLambertMaterial({ color: eyeColor });
        const earMaterial = new THREE.MeshLambertMaterial({ color: earColor });
        const tailMaterial = new THREE.MeshLambertMaterial({ color: tailColor });

        // Body
        const bodyWidth = 0.8, bodyHeight = 0.7, bodyDepth = 1.2;
        const bodyGeometry = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = bodyHeight / 2 + 0.4;
        group.add(body);
        this.bodyMesh = body;

        // Head
        const headSize = 0.6;
        const headGeometry = new THREE.BoxGeometry(headSize, headSize, headSize * 0.9);
        const head = new THREE.Mesh(headGeometry, bodyMaterial);
        head.position.set(0, body.position.y + bodyHeight / 2 - 0.1, bodyDepth / 2 + headSize / 3);
        group.add(head);
        this.headMesh = head;

        // Snout
        const snoutGeometry = new THREE.BoxGeometry(0.4, 0.3, 0.2);
        const snout = new THREE.Mesh(snoutGeometry, snoutMaterial);
        snout.position.set(0, -0.05, headSize * 0.45 + 0.1);
        head.add(snout);

        // Eyes
        const eyeGeometry = new THREE.BoxGeometry(0.08, 0.08, 0.04);
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-headSize/4, 0.1, headSize * 0.45 + 0.02);
        head.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(headSize/4, 0.1, headSize * 0.45 + 0.02);
        head.add(rightEye);

        // Ears
        const earGeometry = new THREE.BoxGeometry(0.2, 0.3, 0.05);
        const leftEar = new THREE.Mesh(earGeometry, earMaterial);
        leftEar.position.set(-headSize/2 + 0.1, headSize/2 + 0.1, 0);
        leftEar.rotation.z = -Math.PI / 8;
        head.add(leftEar);

        const rightEar = new THREE.Mesh(earGeometry, earMaterial);
        rightEar.position.set(headSize/2 - 0.1, headSize/2 + 0.1, 0);
        rightEar.rotation.z = Math.PI / 8;
        head.add(rightEar);

        // Tail - simple curly tail
        const tailGeometry = new THREE.BoxGeometry(0.1, 0.4, 0.1);
        const tail = new THREE.Mesh(tailGeometry, tailMaterial);
        tail.position.set(0, body.position.y, -bodyDepth / 2 - 0.05);
        tail.rotation.x = Math.PI / 4;
        group.add(tail);

        const tailTipGeometry = new THREE.BoxGeometry(0.1, 0.2, 0.1);
        const tailTip = new THREE.Mesh(tailTipGeometry, tailMaterial);
        tailTip.position.set(0, -0.2, -0.05);
        tail.add(tailTip);

        // Legs
        const legLength = 0.4, legSize = 0.2;
        const legGeometry = new THREE.BoxGeometry(legSize, legLength, legSize);
        this.legs = [];
        const legPositions = [
            [-bodyWidth/2 + legSize/2, legLength/2, bodyDepth/2 - legSize/2],
            [bodyWidth/2 - legSize/2, legLength/2, bodyDepth/2 - legSize/2],
            [-bodyWidth/2 + legSize/2, legLength/2, -bodyDepth/2 + legSize/2],
            [bodyWidth/2 - legSize/2, legLength/2, -bodyDepth/2 + legSize/2],
        ];
        legPositions.forEach(pos => {
            const leg = new THREE.Mesh(legGeometry, legMaterial);
            leg.position.set(pos[0], pos[1], pos[2]);
            group.add(leg);
            this.legs.push(leg);
        });
    }

    isBlockSolid(x, y, z) {
        const blockType = this.world.getBlock(x, y, z);
        return blockType !== BlockTypes.AIR && blockType !== BlockTypes.WATER;
    }

    checkCollision(axis) {
        const halfWidth = this.width / 2;
        const offsets = [-halfWidth, halfWidth];
        for (let y = 0; y < Math.ceil(this.height); y++) {
            for (const dx of offsets) {
                for (const dz of offsets) {
                    const checkPos = this.position.clone().add(new THREE.Vector3(dx, y, dz));
                    const blockX = Math.floor(checkPos.x);
                    const blockY = Math.floor(checkPos.y);
                    const blockZ = Math.floor(checkPos.z);
                    if (this.isBlockSolid(blockX, blockY, blockZ)) {
                        if (axis === 'x') {
                            this.position.x = this.velocity.x > 0 ? blockX - halfWidth : blockX + 1 + halfWidth;
                            this.velocity.x = 0;
                        } else if (axis === 'z') {
                            this.position.z = this.velocity.z > 0 ? blockZ - halfWidth : blockZ + 1 + halfWidth;
                            this.velocity.z = 0;
                        } else if (axis === 'y') {
                            if (this.velocity.y > 0) { // Head collision
                                this.position.y = blockY - this.height;
                            } else { // Ground collision
                                this.position.y = blockY + 1;
                                this.onGround = true;
                            }
                            this.velocity.y = 0;
                        }
                    }
                }
            }
        }
    }

    applyPhysics(deltaTime) {
        this.onGround = false; // Reset before checks

        this.velocity.y += this.gravity * deltaTime;
        
        this.position.x += this.velocity.x * deltaTime;
        this.checkCollision('x');
        
        this.position.y += this.velocity.y * deltaTime;
        this.checkCollision('y');
        
        this.position.z += this.velocity.z * deltaTime;
        this.checkCollision('z');
    }

    update(deltaTime) {
        // 1. Run the AI state machine to determine behavior and set velocity
        this.updateAI(deltaTime);

        // 2. Apply physics and collision detection
        this.applyPhysics(deltaTime);

        // 3. Update visual representation
        this.orientMeshToVelocity();
        this.updateAnimation(deltaTime);
        this.updateMeshPosition();
    }

    // --- NEW AI LOGIC ---
    updateAI(deltaTime) {
        this.timeInCurrentState += deltaTime;
        this.obstacleCheckCooldown -= deltaTime;

        // State Machine
        switch (this.state) {
            case AIState.IDLE:
                this.velocity.x *= 0.9; // Slow down
                this.velocity.z *= 0.9;
                this.currentAnimation = 'idle';
                // After some time, start wandering
                if (this.timeInCurrentState > this.maxIdleTime) {
                    this.setState(AIState.WANDERING);
                }
                break;

            case AIState.WANDERING:
                this.currentAnimation = 'walk';
                // If we don't have a target, find one
                if (!this.wanderTarget || this.position.distanceTo(this.wanderTarget) < 2) {
                    this.findNewWanderTarget();
                }
                
                // Move towards the target
                this.moveTowards(this.wanderTarget);
                
                // Periodically check for obstacles
                if (this.obstacleCheckCooldown <= 0) {
                    if (this.checkForObstacles()) {
                        this.setState(AIState.NAVIGATING_OBSTACLE);
                    }
                    this.obstacleCheckCooldown = this.obstacleCheckInterval;
                }

                // If wandering for too long, take a break
                if (this.timeInCurrentState > this.maxWanderTime) {
                    this.setState(AIState.IDLE);
                }
                break;

            case AIState.NAVIGATING_OBSTACLE:
                this.currentAnimation = 'walk';
                // If we don't have a temporary navigation target, find one
                if (!this.navigationTarget) {
                    this.findAlternatePath();
                }

                // Move towards the temporary target
                this.moveTowards(this.navigationTarget);

                // If we've reached the temp target, go back to wandering
                if (this.position.distanceTo(this.navigationTarget) < 1.5) {
                    this.navigationTarget = null;
                    this.setState(AIState.WANDERING);
                }
                
                // Failsafe: if stuck navigating for too long, try something else
                if (this.timeInCurrentState > 5) {
                    this.navigationTarget = null;
                    this.setState(AIState.WANDERING);
                }
                break;
        }
    }
    
    // --- NEW AI HELPER METHODS ---

    setState(newState) {
        if (this.state === newState) return;
        this.state = newState;
        this.timeInCurrentState = 0;
        
        // Reset targets when changing state
        if (newState === AIState.WANDERING) {
            this.navigationTarget = null;
        } else if (newState === AIState.IDLE) {
            this.wanderTarget = null;
            this.navigationTarget = null;
        }
    }

    findNewWanderTarget() {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * this.wanderRadius;
        this.wanderTarget = new THREE.Vector3(
            this.spawnPosition.x + Math.cos(angle) * distance,
            this.position.y, // We don't care about Y for the target
            this.spawnPosition.z + Math.sin(angle) * distance
        );
    }

    moveTowards(target) {
        if (!target) return;
        const direction = target.clone().sub(this.position);
        direction.y = 0; // Move along the XZ plane
        direction.normalize();
        this.velocity.x = direction.x * this.speed;
        this.velocity.z = direction.z * this.speed;
    }

    checkForObstacles() {
        const forward = new THREE.Vector3(this.velocity.x, 0, this.velocity.z).normalize();
        
        // 1. Check for a wall in front
        const checkDist = 1.2; // How far to look ahead
        const frontPos = this.position.clone().add(forward.multiplyScalar(checkDist));
        const blockX = Math.floor(frontPos.x);
        const blockZ = Math.floor(frontPos.z);

        // Check at foot and head level
        const blockAtFeet = this.isBlockSolid(blockX, Math.floor(this.position.y), blockZ);
        const blockAtHead = this.isBlockSolid(blockX, Math.floor(this.position.y + 1), blockZ);

        if (blockAtFeet && !blockAtHead) {
            // It's a 1-block step, let's try to jump
            if (this.onGround) {
                this.velocity.y = this.jumpSpeed;
            }
            return false; // Not a blocking obstacle
        } else if (blockAtFeet && blockAtHead) {
            // It's a solid wall
            return true;
        }

        // 2. Check for a cliff ahead
        const groundCheckPos = this.position.clone().add(forward.multiplyScalar(0.8));
        const groundBlockY = Math.floor(this.position.y - 1);
        if (!this.isBlockSolid(Math.floor(groundCheckPos.x), groundBlockY, Math.floor(groundCheckPos.z))) {
            // No ground in front, it's a drop
            return true;
        }

        return false; // Path is clear
    }

    findAlternatePath() {
        const currentDirection = new THREE.Vector3(this.velocity.x, 0, this.velocity.z).normalize();
        const right = new THREE.Vector3(currentDirection.z, 0, -currentDirection.x); // Perpendicular vector
        const left = right.clone().negate();

        const checkDist = 2.5;
        const rightPos = this.position.clone().add(right.multiplyScalar(checkDist));
        const leftPos = this.position.clone().add(left.multiplyScalar(checkDist));

        // Check if the block at the potential target is solid
        const rightIsClear = !this.isBlockSolid(Math.floor(rightPos.x), Math.floor(this.position.y), Math.floor(rightPos.z));
        const leftIsClear = !this.isBlockSolid(Math.floor(leftPos.x), Math.floor(this.position.y), Math.floor(leftPos.z));

        if (leftIsClear) {
            this.navigationTarget = leftPos;
        } else if (rightIsClear) {
            this.navigationTarget = rightPos;
        } else {
            // Both sides blocked, turn around
            this.findNewWanderTarget(); // Just get a new random target
            this.setState(AIState.WANDERING);
        }
    }
    
    orientMeshToVelocity() {
        if (this.mesh && (Math.abs(this.velocity.x) > 0.1 || Math.abs(this.velocity.z) > 0.1)) {
            const angle = Math.atan2(this.velocity.x, this.velocity.z);
            // Smoothly rotate towards the target angle
            this.mesh.rotation.y += (angle - this.mesh.rotation.y) * 0.1;
        }
    }

    updateAnimation(deltaTime) {
        const time = performance.now() / 1000;

        if (this.currentAnimation === 'walk') {
            const swingAmount = 0.5;
            this.legs[0].rotation.x = Math.sin(time * 5) * swingAmount;         // Front-left
            this.legs[1].rotation.x = -Math.sin(time * 5) * swingAmount;        // Front-right
            this.legs[2].rotation.x = -Math.sin(time * 5) * swingAmount;        // Back-left
            this.legs[3].rotation.x = Math.sin(time * 5) * swingAmount;         // Back-right
            
            // Slight body bob
            if (this.bodyMesh) {
                if (!this.bodyMesh.userData.originalY) {
                    this.bodyMesh.userData.originalY = this.bodyMesh.position.y;
                }
                this.bodyMesh.position.y = this.bodyMesh.userData.originalY + Math.sin(time * 10) * 0.03;
            }
        } else {
            // Idle animation - reset legs to neutral
            this.legs.forEach(leg => {
                leg.rotation.x *= 0.9; // Smoothly return to 0
            });
            
            // Slight breathing
            if (this.bodyMesh) {
                if (!this.bodyMesh.userData.originalY) {
                    this.bodyMesh.userData.originalY = this.bodyMesh.position.y;
                }
                this.bodyMesh.position.y = this.bodyMesh.userData.originalY + Math.sin(time) * 0.02;
            }
        }
        
        // Subtle head movement
        if (this.headMesh) {
            this.headMesh.rotation.y = Math.sin(time * 0.7) * 0.15;
            this.headMesh.rotation.x = Math.cos(time * 0.5) * 0.05;
        }
    }

    updateMeshPosition() {
        if (this.mesh) {
            this.mesh.position.copy(this.position);
        }
    }

    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            this.die();
        }
    }

    die() {
        // Remove from scene and cleanup
        if (this.mesh && this.mesh.parent) {
            this.mesh.parent.remove(this.mesh);
        }
        this.cleanup();
    }

    cleanup() {
        if (this.mesh) {
            this.mesh.traverse(child => {
                if (child instanceof THREE.Mesh) {
                    child.geometry?.dispose();
                    // Dispose materials if they are unique to this mob
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material?.dispose();
                    }
                }
            });
        }
    }
}

export class MobManager {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.mobs = [];
        this.mobsPerChunk = 2; // A more reasonable density cap per chunk
        this.spawnDistance = 24; // Min distance from player to spawn
        this.despawnDistance = 48; // Max distance from player to spawn, and distance to despawn
        this.lastSpawnCheck = 0;
        this.spawnCheckInterval = 2000; // Check more frequently for smoother spawning
    }

    update(deltaTime, playerPosition) {
        // Update all mobs
        this.mobs = this.mobs.filter(mob => {
            if(mob.health > 0) {
                mob.update(deltaTime);
                return true;
            }
            return false;
        });
        
        // Check for spawning and despawning
        const now = Date.now();
        if (now - this.lastSpawnCheck > this.spawnCheckInterval) {
            this.checkSpawning(playerPosition);
            this.checkDespawning(playerPosition);
            this.lastSpawnCheck = now;
        }
    }

    checkSpawning(playerPosition) {
        const loadedChunks = this.world.getLoadedChunks();
        if (loadedChunks.length === 0) return;

        // Dynamic mob cap based on loaded chunks
        const maxMobs = loadedChunks.length * this.mobsPerChunk;
        if (this.mobs.length >= maxMobs) return;

        // Perform one spawn attempt per loaded chunk each cycle
        for (const chunk of loadedChunks) {
            // Pick a random location within the chunk
            const spawnX = chunk.x * 16 + Math.floor(Math.random() * 16);
            const spawnZ = chunk.z * 16 + Math.floor(Math.random() * 16);

            // Check if this point is within the valid spawn ring around the player
            const distanceToPlayer = playerPosition.distanceTo(new THREE.Vector3(spawnX, playerPosition.y, spawnZ));
            if (distanceToPlayer < this.spawnDistance || distanceToPlayer > this.despawnDistance) {
                continue; // Too close or too far from the player
            }

            // Find the ground by scanning from the top of the chunk down
            let groundY = -1;
            let groundBlockType = BlockTypes.AIR;
            for (let y = CHUNK_HEIGHT - 1; y > 0; y--) {
                const blockType = this.world.getBlock(spawnX, y, spawnZ);
                if (blockType !== BlockTypes.AIR && blockType !== BlockTypes.WATER && blockType !== BlockTypes.LEAVES) {
                    groundY = y;
                    groundBlockType = blockType;
                    break;
                }
            }

            if (groundY === -1) continue; // No valid ground found at this X,Z

            // Check for sufficient air space above the ground
            const blockAbove1 = this.world.getBlock(spawnX, groundY + 1, spawnZ);
            const blockAbove2 = this.world.getBlock(spawnX, groundY + 2, spawnZ);

            if (blockAbove1 === BlockTypes.AIR && blockAbove2 === BlockTypes.AIR) {
                // All checks passed, attempt to spawn a mob based on the ground type
                this.spawnMob(new THREE.Vector3(spawnX + 0.5, groundY + 1, spawnZ + 0.5), groundBlockType);
                
                // We successfully spawned a mob, so we can stop this chunk's attempt.
                break; 
            }
        }
    }

    checkDespawning(playerPosition) {
        this.mobs = this.mobs.filter(mob => {
            const distance = mob.position.distanceTo(playerPosition);
            if (distance > this.despawnDistance) {
                mob.die();
                return false;
            }
            return true;
        });
    }

    spawnMob(position, spawnBlockType) {
        // Define which mobs can spawn on which blocks
        const spawnRules = {
            [BlockTypes.GRASS]: [MobTypes.COW, MobTypes.SHEEP, MobTypes.PIG],
            [BlockTypes.DIRT]: [MobTypes.PIG],
            [BlockTypes.SAND]: [MobTypes.PIG]
        };

        const possibleMobs = spawnRules[spawnBlockType];
        if (!possibleMobs || possibleMobs.length === 0) {
            return; // No valid mobs can spawn on this block type
        }

        // Pick a random mob from the valid list
        const randomType = possibleMobs[Math.floor(Math.random() * possibleMobs.length)];
        
        const mob = new Mob(randomType, position, this.world);
        this.mobs.push(mob);
        this.scene.add(mob.mesh);
        
        console.log(`Spawned ${randomType} on ${Object.keys(BlockTypes).find(key => BlockTypes[key] === spawnBlockType)} at`, position.toArray().map(p => p.toFixed(1)));
    }

    getMobs() {
        return this.mobs;
    }

    cleanup() {
        this.mobs.forEach(mob => mob.cleanup());
        this.mobs = [];
    }
}