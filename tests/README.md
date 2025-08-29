# Test Suite Documentation

This directory contains comprehensive tests for the NEAR Protocol Claim List Processor.

## Test Structure

### 1. Unit Tests

#### `merkle-tree.test.ts`

Tests the core Merkle tree functionality:

- **Tree Construction**: Creating trees from various input formats
- **Proof Generation**: Generating cryptographic proofs for entries
- **Proof Verification**: Validating proofs against tree roots
- **Address Format Handling**: Supporting NEAR account IDs and implicit accounts
- **Serialization**: Dumping and loading tree data
- **Security Properties**: keccak256 hashing, double hashing, pair sorting

#### `storage.test.ts`

Tests the storage layer abstractions:

- **Basic Operations**: Store, retrieve, delete data
- **File System Operations**: Directory creation, path handling
- **List Operations**: Key enumeration with prefix filtering
- **Batch Operations**: Efficient bulk storage operations
- **JSON/Blob Utilities**: Specialized data type handling
- **Error Handling**: Corrupted files, permission errors
- **Concurrent Access**: Multiple simultaneous operations

#### `processor.test.ts`

Tests the API and processing workflow:

- **Health Check**: Service availability endpoint
- **Project Management**: Upload, list, manage projects
- **Processing Workflow**: Complete claim processing pipeline
- **Tree and Proof Retrieval**: Data access endpoints
- **Error Handling**: Invalid inputs, missing data
- **Data Validation**: Address and amount validation
- **Large Dataset Handling**: Performance with 1000+ claims
- **Status Progression**: Monitoring processing stages

### 2. Integration Tests

#### `integration.test.ts`

Tests end-to-end workflows and cross-component interactions:

- **End-to-End Claim Processing**: Complete workflow from data to proofs
- **Cross-Verification**: Proof validation across tree instances
- **Storage Consistency**: Data integrity across operations
- **Performance and Scalability**: Efficiency with increasing dataset sizes

## Running Tests

### For CI/GitHub Actions

```bash
npm run test:ci          # Run CI-friendly tests
```

### For Local Development

```bash
npm test                 # Run CI-friendly tests (default)
npm run test:local       # Run ALL tests including heavy ones (watch mode)
```

## Test Configuration Files

- **vitest.config.ts**: Default config (CI-friendly)
- **vitest.config.ci.ts**: Explicit CI configuration
- **vitest.config.local.ts**: Local development configuration (includes heavy tests)

## Heavy Test Patterns

Tests are automatically excluded from CI if they match these patterns:

- Test names containing: `large`, `massive`, `ultra`, `10K`, `100K`, `500K`, `1M`
- Test descriptions containing: `Large Dataset`, `Massive`, `Ultra`

## Memory and Performance Considerations

Heavy tests are excluded from CI because they:

- Can consume >2GB RAM for 1M+ entry tests
- Take > 5 minutes
- May timeout or cause out-of-memory errors in CI environments
- Are primarily for stress testing and performance validation

## GitHub Actions Workflow

The CI workflow (`.github/workflows/test.yml`) runs:

1. Tests on Node.js 18.x and 20.x
2. Build validation
3. CI-friendly test suite

## Test Coverage Areas

### Functional Coverage

- ✅ Merkle tree construction and validation
- ✅ Storage operations (local file system)
- ✅ API endpoints and error handling
- ✅ Data format validation
- ✅ Large dataset processing (local only)
- ✅ Concurrent operations

### Security Testing

- ✅ Proof tampering detection
- ✅ Invalid data rejection
- ✅ Hash collision resistance (via keccak256)
- ✅ Double hashing verification
- ✅ Address format validation

### Performance Testing

- ✅ Large dataset handling (1000+ entries)
- ✅ Proof generation efficiency
- ✅ Storage operation scalability
- ✅ Memory usage patterns (via chunked processing)

### Edge Cases

- ✅ Empty datasets
- ✅ Single entry trees
- ✅ Duplicate address detection
- ✅ Malformed input handling
- ✅ Network/storage failures
- ✅ Concurrent access patterns

## Mock Strategy

The test suite uses minimal mocking to ensure realistic behavior:

1. **NEAR API**: Fully mocked since tests focus on local processing
2. **File System**: Real file operations for integration testing
3. **Network**: No external network calls in current implementation
4. **Time**: Real timestamps for metadata testing

## Performance Benchmarks

Tests include performance benchmarks to ensure scalability:

- **Tree Construction**: Should handle 1000+ entries in <15 seconds
- **Proof Generation**: Should generate proofs in <100ms each
- **Batch Storage**: Should store 100 items efficiently
- **Memory Usage**: Chunked processing prevents memory exhaustion

## Debugging Tests

### Verbose Output

```bash
# Run with detailed output
npx vitest --reporter=verbose

# Run specific test with debug info
npx vitest tests/merkle-tree.test.ts --reporter=verbose
```

### Test Data Inspection

Tests create temporary directories for data inspection:

- `./test-data/` - Storage layer tests
- `./test-processor-data/` - Processor tests
- `./test-integration-data/` - Integration tests

Data is cleaned up automatically, but can be preserved by commenting out `afterEach` cleanup code.

## Continuous Integration

Tests are designed to run reliably in CI environments:

- No external dependencies
- Deterministic execution
- Reasonable timeouts
- Proper cleanup
