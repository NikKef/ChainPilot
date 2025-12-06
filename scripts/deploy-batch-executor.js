/**
 * Q402 BatchExecutor Contract Deployment Script
 * 
 * Deploys the Q402BatchExecutor contract to BSC Testnet or Mainnet
 * This contract enables gas-sponsored batch execution of transfers, swaps, and calls
 * 
 * Usage:
 *   npx hardhat run scripts/deploy-batch-executor.js --network bscTestnet
 *   npx hardhat run scripts/deploy-batch-executor.js --network bscMainnet
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// PancakeSwap Router addresses
const PANCAKE_ROUTER = {
  mainnet: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  testnet: "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
};

async function main() {
  console.log("\n🚀 Q402 BatchExecutor Contract Deployment\n");
  console.log("=".repeat(50));

  // Get deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log(`\n📍 Network: ${hre.network.name}`);
  console.log(`👤 Deployer: ${deployer.address}`);

  // Check balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  const balanceInBNB = hre.ethers.formatEther(balance);
  console.log(`💰 Balance: ${balanceInBNB} BNB`);

  if (parseFloat(balanceInBNB) < 0.01) {
    console.error("\n❌ Insufficient balance! Need at least 0.01 BNB for deployment.");
    console.log("   Get testnet BNB from: https://testnet.bnbchain.org/faucet-smart");
    process.exit(1);
  }

  // Determine network type
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const isTestnet = chainId === 97n;
  const networkType = isTestnet ? "testnet" : "mainnet";

  // Get PancakeSwap router for this network
  const pancakeRouter = PANCAKE_ROUTER[networkType];
  console.log(`\n🔄 PancakeSwap Router: ${pancakeRouter}`);

  console.log("\n📦 Deploying Q402BatchExecutor...");

  // Deploy contract
  const Q402BatchExecutor = await hre.ethers.getContractFactory("Q402BatchExecutor");
  const batchExecutor = await Q402BatchExecutor.deploy(deployer.address, pancakeRouter);

  await batchExecutor.waitForDeployment();

  const contractAddress = await batchExecutor.getAddress();
  console.log(`✅ Q402BatchExecutor deployed to: ${contractAddress}`);

  // Get deployment transaction
  const deploymentTx = batchExecutor.deploymentTransaction();
  console.log(`📝 Transaction hash: ${deploymentTx.hash}`);

  // Wait for more confirmations
  console.log("\n⏳ Waiting for confirmations...");
  await deploymentTx.wait(3);
  console.log("✅ Confirmed!");

  // Add facilitator address if specified
  const facilitatorAddress = process.env.FACILITATOR_ADDRESS;
  if (facilitatorAddress && facilitatorAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`\n👥 Adding facilitator: ${facilitatorAddress}`);
    const tx = await batchExecutor.setFacilitator(facilitatorAddress, true);
    await tx.wait();
    console.log("✅ Facilitator added!");
  }

  // Whitelist additional routers if specified
  const additionalRouters = process.env.ADDITIONAL_ROUTERS?.split(",").filter(Boolean) || [];
  for (const router of additionalRouters) {
    console.log(`\n🔄 Whitelisting router: ${router}`);
    const tx = await batchExecutor.setRouterWhitelist(router.trim(), true);
    await tx.wait();
    console.log("✅ Router whitelisted!");
  }

  // Whitelist Q402Implementation for calls if deployed
  const q402ImplementationPath = path.join(__dirname, "..", "deployments", `q402-${hre.network.name}.json`);
  if (fs.existsSync(q402ImplementationPath)) {
    const q402Deployment = JSON.parse(fs.readFileSync(q402ImplementationPath, "utf8"));
    console.log(`\n📋 Whitelisting Q402Implementation: ${q402Deployment.contractAddress}`);
    const tx = await batchExecutor.setTargetWhitelist(q402Deployment.contractAddress, true);
    await tx.wait();
    console.log("✅ Q402Implementation whitelisted for calls!");
  }

  // Get domain separator for verification
  const domainSeparator = await batchExecutor.domainSeparator();
  console.log(`\n🔐 Domain Separator: ${domainSeparator}`);

  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    networkType,
    chainId: Number(chainId),
    contractAddress,
    deployerAddress: deployer.address,
    facilitatorAddress: facilitatorAddress || deployer.address,
    pancakeRouterAddress: pancakeRouter,
    transactionHash: deploymentTx.hash,
    domainSeparator,
    deployedAt: new Date().toISOString(),
    contractName: "Q402BatchExecutor",
    version: "1",
  };

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Save to file
  const filename = path.join(deploymentsDir, `batch-executor-${hre.network.name}.json`);
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n💾 Deployment info saved to: ${filename}`);

  // Print environment variable update
  console.log("\n" + "=".repeat(50));
  console.log("📋 UPDATE YOUR .env FILE WITH:");
  console.log("=".repeat(50));
  
  if (isTestnet) {
    console.log(`\nQ402_BATCH_EXECUTOR_TESTNET=${contractAddress}`);
  } else {
    console.log(`\nQ402_BATCH_EXECUTOR_MAINNET=${contractAddress}`);
  }

  // Print explorer link
  const explorerUrl = isTestnet 
    ? `https://testnet.bscscan.com/address/${contractAddress}`
    : `https://bscscan.com/address/${contractAddress}`;
  
  console.log(`\n🔍 View on explorer: ${explorerUrl}`);

  // Verify contract on BscScan (if API key is available)
  if (process.env.BSCSCAN_API_KEY) {
    console.log("\n📝 Verifying contract on BscScan...");
    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [deployer.address, pancakeRouter],
      });
      console.log("✅ Contract verified!");
    } catch (error) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ Contract already verified!");
      } else {
        console.log(`⚠️ Verification failed: ${error.message}`);
        console.log("   You can verify manually at: https://bscscan.com/verifyContract");
      }
    }
  }

  // Print summary of whitelisted addresses
  console.log("\n" + "=".repeat(50));
  console.log("📋 WHITELISTED ADDRESSES:");
  console.log("=".repeat(50));
  console.log(`\n✅ Facilitator: ${facilitatorAddress || deployer.address}`);
  console.log(`✅ PancakeSwap Router: ${pancakeRouter}`);
  if (additionalRouters.length > 0) {
    additionalRouters.forEach(r => console.log(`✅ Additional Router: ${r.trim()}`));
  }

  console.log("\n🎉 Deployment complete!\n");

  // Instructions for next steps
  console.log("=".repeat(50));
  console.log("📋 NEXT STEPS:");
  console.log("=".repeat(50));
  console.log("\n1. Update src/lib/utils/constants.ts with the new contract address");
  console.log("2. Users must approve this contract for their tokens (one-time)");
  console.log("3. The facilitator can now execute batched operations with gas sponsorship");
  console.log("\nFor swaps to be gas-free:");
  console.log("   - User approves Q402BatchExecutor for input tokens");
  console.log("   - User signs a BatchWitness with all operations");
  console.log("   - Facilitator calls executeBatch() and pays all gas");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });

