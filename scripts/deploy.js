import pkg from 'hardhat';
const { ethers } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("🧑 Deployer address:", deployer.address);

  const LandNFT = await ethers.getContractFactory("LandNFT");
  const contract = await LandNFT.deploy();

  await contract.waitForDeployment();
  const deployedAddress = await contract.getAddress();

  console.log("✅ LandNFT deployed at:", deployedAddress);
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exitCode = 1;
});