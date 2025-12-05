/**
 * Update Constants Script
 * 
 * Reads the deployment info and updates the constants file and .env
 * 
 * Usage:
 *   node scripts/update-constants.js testnet
 *   node scripts/update-constants.js mainnet
 */

const fs = require("fs");
const path = require("path");

async function main() {
  const networkType = process.argv[2] || "testnet";
  const networkName = networkType === "mainnet" ? "bscMainnet" : "bscTestnet";

  console.log(`\n📝 Updating constants for ${networkType}...\n`);

  // Read deployment info
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFile = path.join(deploymentsDir, `q402-${networkName}.json`);

  if (!fs.existsSync(deploymentFile)) {
    console.error(`❌ Deployment file not found: ${deploymentFile}`);
    console.log(`   Run deployment first: npm run deploy:${networkType}`);
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  console.log(`✅ Found deployment: ${deployment.contractAddress}`);

  // Read current .env file
  const envFile = path.join(__dirname, "..", ".env");
  const envLocalFile = path.join(__dirname, "..", ".env.local");
  
  let envPath = envLocalFile;
  if (!fs.existsSync(envLocalFile) && fs.existsSync(envFile)) {
    envPath = envFile;
  }

  let envContent = "";
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf8");
  }

  // Update environment variables
  const updates = {};
  if (networkType === "testnet") {
    updates["Q402_IMPLEMENTATION_TESTNET"] = deployment.contractAddress;
    updates["Q402_VERIFIER_TESTNET"] = deployment.contractAddress;
    updates["Q402_FACILITATOR_WALLET_TESTNET"] = deployment.facilitatorAddress;
  } else {
    updates["Q402_IMPLEMENTATION_MAINNET"] = deployment.contractAddress;
    updates["Q402_VERIFIER_MAINNET"] = deployment.contractAddress;
    updates["Q402_FACILITATOR_WALLET_MAINNET"] = deployment.facilitatorAddress;
  }

  // Update .env content
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (envContent.match(regex)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }

  // Write updated .env
  fs.writeFileSync(envPath, envContent);
  console.log(`✅ Updated ${envPath}`);

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("📋 DEPLOYMENT SUMMARY");
  console.log("=".repeat(50));
  console.log(`\n🔗 Network: ${networkType}`);
  console.log(`📝 Contract: ${deployment.contractAddress}`);
  console.log(`👤 Facilitator: ${deployment.facilitatorAddress}`);
  console.log(`🕐 Deployed at: ${deployment.deployedAt}`);

  const explorerUrl = networkType === "testnet"
    ? `https://testnet.bscscan.com/address/${deployment.contractAddress}`
    : `https://bscscan.com/address/${deployment.contractAddress}`;
  
  console.log(`\n🔍 Explorer: ${explorerUrl}`);
  console.log("\n✅ Constants updated successfully!\n");
}

main().catch(console.error);

