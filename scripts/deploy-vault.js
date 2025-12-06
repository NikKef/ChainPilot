/**
 * Q402 Vault Contract Deployment Script
 * 
 * Deploys the Q402Vault contract to BSC Testnet or Mainnet
 * The vault enables gas-sponsored native BNB transfers with policy enforcement
 * 
 * Usage:
 *   npx hardhat run scripts/deploy-vault.js --network bscTestnet
 *   npx hardhat run scripts/deploy-vault.js --network bscMainnet
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n🏦 Q402 Vault Contract Deployment\n");
  console.log("=".repeat(50));

  // Get deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log(`\n📍 Network: ${hre.network.name}`);
  console.log(`👤 Deployer: ${deployer.address}`);

  // Check balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  const balanceInBNB = hre.ethers.formatEther(balance);
  console.log(`💰 Balance: ${balanceInBNB} BNB`);

  if (parseFloat(balanceInBNB) < 0.002) {
    console.error("\n❌ Insufficient balance! Need at least 0.002 BNB for deployment.");
    console.log("   Get testnet BNB from: https://testnet.bnbchain.org/faucet-smart");
    process.exit(1);
  }

  console.log("\n📦 Deploying Q402Vault...");

  // Deploy contract
  const Q402Vault = await hre.ethers.getContractFactory("Q402Vault");
  const vault = await Q402Vault.deploy(deployer.address);

  await vault.waitForDeployment();

  const contractAddress = await vault.getAddress();
  console.log(`✅ Q402Vault deployed to: ${contractAddress}`);

  // Get deployment transaction
  const deploymentTx = vault.deploymentTransaction();
  console.log(`📝 Transaction hash: ${deploymentTx.hash}`);

  // Wait for more confirmations
  console.log("\n⏳ Waiting for confirmations...");
  await deploymentTx.wait(3);
  console.log("✅ Confirmed!");

  // Add facilitator address if set in environment
  const facilitatorAddress = process.env.FACILITATOR_ADDRESS;
  if (facilitatorAddress && facilitatorAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`\n👥 Adding facilitator: ${facilitatorAddress}`);
    const tx = await vault.setFacilitator(facilitatorAddress, true);
    await tx.wait();
    console.log("✅ Facilitator added!");
  }

  // Get domain separator for verification
  const domainSeparator = await vault.domainSeparator();
  const chainId = await vault.getChainId();
  console.log(`\n🔐 Domain Separator: ${domainSeparator}`);
  console.log(`⛓️  Chain ID: ${chainId}`);

  // Determine network type
  const isTestnet = chainId === 97n;
  const networkType = isTestnet ? "testnet" : "mainnet";

  // Save deployment info
  const deploymentInfo = {
    contract: "Q402Vault",
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
  const filename = path.join(deploymentsDir, `vault-${hre.network.name}.json`);
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n💾 Deployment info saved to: ${filename}`);

  // Print environment variable update
  console.log("\n" + "=".repeat(50));
  console.log("📋 UPDATE YOUR .env FILE WITH:");
  console.log("=".repeat(50));
  
  if (isTestnet) {
    console.log(`\nQ402_VAULT_TESTNET=${contractAddress}`);
  } else {
    console.log(`\nQ402_VAULT_MAINNET=${contractAddress}`);
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

  console.log("\n" + "=".repeat(50));
  console.log("📖 USAGE INSTRUCTIONS:");
  console.log("=".repeat(50));
  console.log(`
1. Users deposit BNB to the vault:
   - Call deposit() with BNB value
   - Or simply send BNB to ${contractAddress}

2. Check user balance:
   - Call getBalance(userAddress)

3. Execute gas-sponsored transfer:
   - User signs EIP-712 transfer authorization
   - Facilitator calls executeTransfer()
   - User's vault balance is transferred to recipient
   - Facilitator pays gas, policy is enforced
`);

  console.log("🎉 Vault deployment complete!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });

