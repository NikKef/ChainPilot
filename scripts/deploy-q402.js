/**
 * Q402 Contract Deployment Script
 * 
 * Deploys the Q402Implementation contract to BSC Testnet or Mainnet
 * 
 * Usage:
 *   npx hardhat run scripts/deploy-q402.js --network bscTestnet
 *   npx hardhat run scripts/deploy-q402.js --network bscMainnet
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n🚀 Q402 Contract Deployment\n");
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

  console.log("\n📦 Deploying Q402Implementation...");

  // Deploy contract
  const Q402Implementation = await hre.ethers.getContractFactory("Q402Implementation");
  const q402 = await Q402Implementation.deploy(deployer.address);

  await q402.waitForDeployment();

  const contractAddress = await q402.getAddress();
  console.log(`✅ Q402Implementation deployed to: ${contractAddress}`);

  // Get deployment transaction
  const deploymentTx = q402.deploymentTransaction();
  console.log(`📝 Transaction hash: ${deploymentTx.hash}`);

  // Wait for more confirmations
  console.log("\n⏳ Waiting for confirmations...");
  await deploymentTx.wait(3);
  console.log("✅ Confirmed!");

  // Add facilitator address if different from deployer
  const facilitatorAddress = process.env.FACILITATOR_ADDRESS;
  if (facilitatorAddress && facilitatorAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`\n👥 Adding facilitator: ${facilitatorAddress}`);
    const tx = await q402.setFacilitator(facilitatorAddress, true);
    await tx.wait();
    console.log("✅ Facilitator added!");
  }

  // Get domain separator for verification
  const domainSeparator = await q402.domainSeparator();
  console.log(`\n🔐 Domain Separator: ${domainSeparator}`);

  // Determine network type
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const isTestnet = chainId === 97n;
  const networkType = isTestnet ? "testnet" : "mainnet";

  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    networkType,
    chainId: Number(chainId),
    contractAddress,
    deployerAddress: deployer.address,
    facilitatorAddress: facilitatorAddress || deployer.address,
    transactionHash: deploymentTx.hash,
    domainSeparator,
    deployedAt: new Date().toISOString(),
  };

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Save to file
  const filename = path.join(deploymentsDir, `q402-${hre.network.name}.json`);
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n💾 Deployment info saved to: ${filename}`);

  // Print environment variable update
  console.log("\n" + "=".repeat(50));
  console.log("📋 UPDATE YOUR .env FILE WITH:");
  console.log("=".repeat(50));
  
  if (isTestnet) {
    console.log(`\nQ402_IMPLEMENTATION_TESTNET=${contractAddress}`);
    console.log(`Q402_VERIFIER_TESTNET=${contractAddress}`);
    console.log(`Q402_FACILITATOR_WALLET_TESTNET=${facilitatorAddress || deployer.address}`);
  } else {
    console.log(`\nQ402_IMPLEMENTATION_MAINNET=${contractAddress}`);
    console.log(`Q402_VERIFIER_MAINNET=${contractAddress}`);
    console.log(`Q402_FACILITATOR_WALLET_MAINNET=${facilitatorAddress || deployer.address}`);
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
        constructorArguments: [deployer.address],
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

  console.log("\n🎉 Deployment complete!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });

