# NEAR Claim Processor Architecture Diagrams

## 1. System Architecture Overview

```mermaid
graph TB
    subgraph "Client Applications"
        Web[Web App]
        CLI[CLI Tool]
        API[Direct API]
    end

    subgraph "NEAR Claim Processor"
        Express[Express Server]
        Processor[Tree Processor]
        MerkleTree[Merkle Tree Engine]
        Storage[Storage Layer]
    end

    subgraph "Storage Backends"
        LocalFS[Local File System]
        GCS[Google Cloud Storage]
    end

    subgraph "Google Cloud"
        GCSBucket[GCS Bucket]
        ServiceAccount[Service Account]
    end

    Web --> Express
    CLI --> Express
    API --> Express

    Express --> Processor
    Processor --> MerkleTree
    Processor --> Storage

    Storage --> LocalFS
    Storage --> GCS

    GCS --> GCSBucket
    GCS --> ServiceAccount

    style Express fill:#e1f5fe
    style MerkleTree fill:#f3e5f5
    style Storage fill:#e8f5e8
```

## 2. Data Flow - Claim Processing Workflow

```mermaid
sequenceDiagram
    participant Client
    participant API as Express API
    participant Processor as Tree Processor
    participant MerkleTree as Merkle Tree
    participant Storage as Storage Layer

    Client->>API: POST /upload/{projectId}
    API->>API: Validate entitlements
    API->>Storage: Store entitlement data
    Storage-->>API: Confirmation
    API-->>Client: Upload success

    Client->>API: GET /root?project_id={id}
    API->>Processor: Create TreeProcessor
    API-->>Client: Status: started

    Note over Processor: Background Processing
    Processor->>Storage: Load entitlements
    Storage-->>Processor: Entitlement data

    Processor->>Processor: Status: verifying
    Processor->>Processor: Validate addresses

    Processor->>Processor: Status: building
    Processor->>MerkleTree: Create tree from values
    MerkleTree->>MerkleTree: Sort leaves by hash
    MerkleTree->>MerkleTree: Build tree structure
    MerkleTree-->>Processor: Complete tree

    Processor->>Storage: Store tree data
    Processor->>Processor: Status: generating

    loop For each address
        Processor->>MerkleTree: Generate proof
        MerkleTree-->>Processor: Proof data
    end

    Processor->>Processor: Status: publishing
    Processor->>Storage: Batch store proofs
    Processor->>Processor: Status: complete

    Client->>API: GET /root?project_id={id}
    API-->>Client: Status: complete + root hash

    Client->>API: GET /proof/{projectId}/{address}
    API->>Storage: Retrieve proof
    Storage-->>API: Proof data
    API-->>Client: Verification proof
```

## 3. Merkle Tree Structure and Operations

```mermaid
graph TD
    subgraph "Input Processing"
        Entitlements["Entitlements<br/>[address, amount]"]
        Convert[Convert Values]
        Encode[Encode to Buffer]
        Hash1[keccak256 Hash]
        Hash2[keccak256 Hash Again]
    end

    subgraph "Tree Construction"
        Leaves[Sorted Leaves]
        TreeBuild[Build Binary Tree]
        Root[Root Hash]
    end

    subgraph "Proof Generation"
        LeafSelect[Select Leaf]
        SiblingPath[Collect Sibling Path]
        ProofArray[Proof Array]
    end

    subgraph "Verification"
        VerifyInput[Leaf Value + Proof]
        RecomputeHash[Recompute Hash Path]
        CompareRoot[Compare with Root]
        Valid[Valid/Invalid]
    end

    Entitlements --> Convert
    Convert --> Encode
    Encode --> Hash1
    Hash1 --> Hash2
    Hash2 --> Leaves

    Leaves --> TreeBuild
    TreeBuild --> Root

    TreeBuild --> LeafSelect
    LeafSelect --> SiblingPath
    SiblingPath --> ProofArray

    ProofArray --> VerifyInput
    VerifyInput --> RecomputeHash
    RecomputeHash --> CompareRoot
    CompareRoot --> Valid

    style Root fill:#ffcdd2
    style ProofArray fill:#c8e6c9
    style Valid fill:#dcedc8
```

## Key Features Highlighted:

1. **Modular Architecture**: Clean separation between API, processing, storage, and cryptographic components
2. **Flexible Storage**: Support for both local development and Google Cloud Storage for production
3. **Async Processing**: Non-blocking tree generation and proof creation
4. **Comprehensive Testing**: Unit, integration, and performance tests
5. **Error Resilience**: Proper error handling and status tracking
6. **Scalable Design**: Handles large datasets efficiently with chunked processing
