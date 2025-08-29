// mesher.js
import { CHUNK_SIZE, CHUNK_HEIGHT } from './utils.js';

export class ChunkMesher {
    constructor() {
        this.opaqueMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.9,
            metalness: 0.0
        });
        this.transparentMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            roughness: 0.2,
            metalness: 0.0
        });
    }
    
    createMeshFromData(opaqueData, transparentData, chunkX, chunkZ) {
        const group = new THREE.Group();

        if (opaqueData.vertices.length > 0) {
            const geometry = this.createBufferGeometry(opaqueData);
            const mesh = new THREE.Mesh(geometry, this.opaqueMaterial);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
        }

        if (transparentData.vertices.length > 0) {
            const geometry = this.createBufferGeometry(transparentData);
            const mesh = new THREE.Mesh(geometry, this.transparentMaterial);
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            group.add(mesh);
        }

        if (group.children.length === 0) return null;
        
        // Position the group at the chunk's world position
        group.position.set(chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE);
        
        // Set a conservative bounding box for the entire group to prevent culling issues
        // This ensures the chunk is visible when any part of it should be in view
        const expandedBoundingBox = new THREE.Box3(
            new THREE.Vector3(-1, -1, -1), // Slightly expanded bounds
            new THREE.Vector3(CHUNK_SIZE + 1, CHUNK_HEIGHT + 1, CHUNK_SIZE + 1)
        );
        
        // Apply the bounding box to the group itself
        group.boundingBox = expandedBoundingBox;
        
        // Override the frustum culling for the group
        group.frustumCulled = true; // Keep frustum culling enabled
        
        // Ensure child meshes compute their bounding boxes properly
        group.children.forEach(child => {
            if (child.geometry) {
                // Let Three.js compute the actual geometry bounds
                child.geometry.computeBoundingBox();
                child.geometry.computeBoundingSphere();
            }
        });
        
        return group;
    }

    createBufferGeometry({ vertices, colors, indices }) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeVertexNormals();
        
        // Let Three.js compute the bounding box and sphere based on actual geometry
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        
        return geometry;
    }
}